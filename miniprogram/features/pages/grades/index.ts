import { getGrades } from "../../../services/teaching";
import {
  getErrorMessage,
  shouldShowRefreshFailureFeedback,
} from "../../../services/request";
import {
  claimAutomaticRefresh,
  FIFTEEN_DAYS_MS,
  isCacheStale,
  isUpstreamRefreshResult,
  shouldStoreServerSnapshot,
} from "../../../store/cache-policy";
import {
  loadGradesSnapshot,
  loadGradesSnapshotForPreference,
  saveGradesSnapshot,
} from "../../../store/grades";
import { loadPreferences } from "../../../store/preferences";
import {
  captureSessionLease,
  getSession,
  isSessionLeaseCurrent,
  sessionLeaseKey,
  type SessionLease,
} from "../../../store/session";
import type {
  AcademicSemesterOption,
  GradeCourse,
  GradeSummary,
  GradesData,
  GradesQuery,
} from "../../../types/api";
import { resolveAppearance } from "../../../utils/appearance";
import { formatDateTime } from "../../../utils/date";
import { formatCredits, formatScore, scoreTone } from "../../../utils/format";
import {
  gradesForSemester,
  isMakeupOrDeferredGrade,
  isUnsuccessfulGrade,
  latestGradedSemester,
} from "../../../utils/grades";
import { haptic } from "../../../utils/haptics";
import { ensureAuthenticated, navigateTo } from "../../../utils/navigation";
import { progressRingSource } from "../../../utils/progress-ring";
import {
  createRefreshPageToken,
  findRefreshFlight,
  isRefreshPageVisible,
  markRefreshPageHidden,
  markRefreshPageVisible,
  startRefreshFlight,
  type RefreshFlight,
} from "../../utils/refresh-flight";
import {
  showRefreshConfirmation,
  showRefreshFailure,
} from "../../utils/refresh-feedback";
import { numberedAcademicSemesterLabel } from "../../../utils/semester";
import {
  canActivateTap,
  movementExceedsTapThreshold,
  type TapPoint,
} from "../../utils/tap-guard";

interface GradeComponentPreview {
  name: string;
  score: string;
}

interface GradeView extends GradeCourse {
  renderKey: string;
  animateEntry: boolean;
  animationDelay: number;
  displayScore: string;
  scoreTone: string;
  compactScore: boolean;
  creditsLabel: string;
  hasGradePoint: boolean;
  gradePointLabel: string;
  componentPreview: GradeComponentPreview[];
}

interface SemesterChip {
  id: string;
  label: string;
  academicYear: number;
  term: number;
}

type GradeSortMode = "default" | "score-desc" | "score-asc";

interface SortConfig {
  sort: NonNullable<GradesQuery["sort"]>;
  order: NonNullable<GradesQuery["order"]>;
  label: string;
}

interface GradeSortFilterController {
  toggle(anchor: { bottom: number; right: number }): void;
}

interface GradesRefreshInput {
  academicYear: number;
  term: number;
  queryText: string;
  sort: NonNullable<GradesQuery["sort"]>;
  order: NonNullable<GradesQuery["order"]>;
  sortMode: GradeSortMode;
  includeUnsuccessful: boolean;
}

interface GradesRefreshOutcome {
  succeeded: boolean;
  showFailureFeedback?: boolean;
  input: GradesRefreshInput;
  result: Awaited<ReturnType<typeof getGrades>> | null;
  errorMessage: string;
}

const PAGE_SIZE = 5000;
const SORT_CONFIG: Record<GradeSortMode, SortConfig> = {
  default: { sort: "default", order: "desc", label: "默认" },
  "score-desc": {
    sort: "finalScore",
    order: "desc",
    label: "分数高→低",
  },
  "score-asc": {
    sort: "finalScore",
    order: "asc",
    label: "分数低→高",
  },
};

let requestSequence = 0;
let hydratedGradesAccount = "";
let gradeRenderBatch = 0;
let gradeListAnimationRequested = true;
let gradeTouchStart: TapPoint | null = null;
let gradeTouchMoved = false;
let lastGradeScrollAt = 0;

function gradesRefreshFlightKey(lease: SessionLease): string {
  return `grades:${sessionLeaseKey(lease)}`;
}

async function refreshGrades(
  lease: SessionLease,
  input: GradesRefreshInput,
): Promise<GradesRefreshOutcome> {
  try {
    const refreshed = await getGrades({
      page: 1,
      pageSize: PAGE_SIZE,
      includeUnsuccessful: input.includeUnsuccessful,
      refresh: true,
    });
    if (!isSessionLeaseCurrent(lease)) {
      return { succeeded: false, input, result: null, errorMessage: "" };
    }
    if (!isUpstreamRefreshResult(refreshed.meta)) {
      return {
        succeeded: false,
        showFailureFeedback: refreshed.meta.stale === true,
        input,
        result: null,
        errorMessage: "",
      };
    }
    const local = loadGradesSnapshotForPreference(
      lease.account,
      input.includeUnsuccessful,
    );
    if (shouldStoreServerSnapshot(local, refreshed.meta, true)) {
      saveGradesSnapshot(
        lease.account,
        refreshed.data,
        refreshed.meta.fetchedAt,
        input.includeUnsuccessful,
      );
    }
    let result = refreshed;
    if (input.queryText || input.sort !== "default" || input.order !== "desc") {
      result = await getGrades({
        page: 1,
        pageSize: PAGE_SIZE,
        academicYear: input.academicYear || undefined,
        term: (input.term || undefined) as 1 | 2 | 3 | undefined,
        q: input.queryText || undefined,
        sort: input.sort,
        order: input.order,
        includeUnsuccessful: input.includeUnsuccessful,
      });
    } else if (input.academicYear && input.term) {
      const semester = refreshed.data.semesters.find(
        (item) =>
          item.academicYear === input.academicYear && item.term === input.term,
      );
      if (semester) {
        result = {
          ...refreshed,
          data: gradesForSemester(refreshed.data, semester),
        };
      }
    }
    if (!isSessionLeaseCurrent(lease)) {
      return { succeeded: false, input, result: null, errorMessage: "" };
    }
    return { succeeded: true, input, result, errorMessage: "" };
  } catch (error) {
    return {
      succeeded: false,
      showFailureFeedback: shouldShowRefreshFailureFeedback(error),
      input,
      result: null,
      errorMessage: getErrorMessage(error, "成绩加载失败。"),
    };
  }
}

function isCompactScore(value: string): boolean {
  const normalized = value.trim();
  if (/^-?\d{1,3}$/.test(normalized)) return false;
  return Array.from(normalized).length > 2;
}

function toGradeView(
  course: GradeCourse,
  renderKey: string,
  animateEntry: boolean,
  animationDelay: number,
): GradeView {
  const displayScore = formatScore(course.finalScore);
  const components = isMakeupOrDeferredGrade(course) ? [] : course.components;
  return {
    ...course,
    components,
    renderKey,
    animateEntry,
    animationDelay,
    displayScore,
    scoreTone: scoreTone(course.finalScore, isUnsuccessfulGrade(course)),
    compactScore: isCompactScore(displayScore),
    creditsLabel: formatCredits(course.credits),
    hasGradePoint: typeof course.gradePoint === "number",
    gradePointLabel:
      typeof course.gradePoint === "number"
        ? course.gradePoint.toFixed(1)
        : "—",
    componentPreview: components.slice(0, 3).map((component) => ({
      name: component.name,
      score: formatScore(component.score),
    })),
  };
}

function touchPoint(
  event: WechatMiniprogram.TouchEvent,
  changed = false,
): TapPoint | null {
  const touches = changed ? event.changedTouches : event.touches;
  const touch = touches[0];
  if (!touch) return null;
  return { x: Number(touch.clientX), y: Number(touch.clientY) };
}

function buildSemesterChips(
  semesters: AcademicSemesterOption[],
): SemesterChip[] {
  return semesters.map((semester) => ({
    id: `${semester.academicYear}-${semester.term}`,
    label: numberedAcademicSemesterLabel(semester),
    academicYear: semester.academicYear,
    term: semester.term,
  }));
}

function summaryDefaults(): GradeSummary {
  return {
    courseCount: 0,
    totalCredits: 0,
    weightedAverage: null,
    gradePointAverage: null,
  };
}

function displayAverage(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    visualTheme: "default",
    visualThemeClass: "theme-style-default",
    motionClass: "motion-normal",
    loading: true,
    refreshing: false,
    loadingMore: false,
    errorMessage: "",
    loaded: false,
    searchFocused: false,
    queryText: "",
    gradeItems: [] as GradeView[],
    summary: summaryDefaults(),
    averageRingSource: progressRingSource(null),
    averageLabel: "—",
    gradePointAverageLabel: "—",
    page: 1,
    totalPages: 1,
    total: 0,
    academicYear: 0,
    term: 0,
    sort: "default" as NonNullable<GradesQuery["sort"]>,
    order: "desc" as NonNullable<GradesQuery["order"]>,
    sortMode: "default" as GradeSortMode,
    sortLabel: "默认",
    filterLabel: "全部成绩",
    sourceLabel: "尚未更新",
    availableSemesters: [] as AcademicSemesterOption[],
    semesterChips: [] as SemesterChip[],
    activeSemesterId: "all",
    semesterInitialized: false,
    includeUnsuccessful: loadPreferences().showGradesBelow60,
    refreshPageToken: 0,
    observedRefreshFlightId: 0,
  },
  onLoad() {
    hydratedGradesAccount = "";
    requestSequence += 1;
    gradeRenderBatch = 0;
    gradeListAnimationRequested = true;
    gradeTouchStart = null;
    gradeTouchMoved = false;
    lastGradeScrollAt = 0;
    const refreshPageToken = createRefreshPageToken();
    markRefreshPageVisible(refreshPageToken);
    this.setData({ refreshPageToken });
    this.applyAppearance();
    this.syncActiveGradesRefresh();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    markRefreshPageVisible(this.data.refreshPageToken);
    const includeUnsuccessful = loadPreferences().showGradesBelow60;
    if (includeUnsuccessful !== this.data.includeUnsuccessful) {
      hydratedGradesAccount = "";
      requestSequence += 1;
      this.setData({
        includeUnsuccessful,
        gradeItems: [],
        summary: summaryDefaults(),
        averageRingSource: progressRingSource(null),
        averageLabel: "—",
        gradePointAverageLabel: "—",
        total: 0,
        availableSemesters: [],
        semesterChips: [],
        loaded: false,
        semesterInitialized: false,
        academicYear: 0,
        term: 0,
        activeSemesterId: "all",
      });
    }
    this.applyAppearance();
    this.hydrateGrades();
    if (!this.syncActiveGradesRefresh()) {
      void this.loadGrades(true, false);
    }
  },
  onHide() {
    markRefreshPageHidden(this.data.refreshPageToken);
  },
  onUnload() {
    markRefreshPageHidden(this.data.refreshPageToken);
  },
  applyAppearance() {
    this.setData(resolveAppearance());
  },
  initializeLatestSemester(data: GradesData): AcademicSemesterOption | null {
    if (this.data.semesterInitialized) return null;
    const semester = latestGradedSemester(data);
    this.setData({
      semesterInitialized: true,
      academicYear: semester?.academicYear || 0,
      term: semester?.term || 0,
      activeSemesterId: semester?.id || "all",
      filterLabel: semester?.label || "全部成绩",
    });
    return semester;
  },
  hydrateGrades() {
    const account = getSession()?.user.account || "";
    if (!account || hydratedGradesAccount === account) return;
    if (hydratedGradesAccount && hydratedGradesAccount !== account) {
      requestSequence += 1;
      gradeRenderBatch += 1;
      this.setData({
        loading: false,
        refreshing: false,
        loadingMore: false,
        gradeItems: [],
        summary: summaryDefaults(),
        averageRingSource: progressRingSource(null),
        averageLabel: "—",
        gradePointAverageLabel: "—",
        page: 1,
        totalPages: 1,
        total: 0,
        academicYear: 0,
        term: 0,
        filterLabel: "全部成绩",
        sourceLabel: "尚未更新",
        availableSemesters: [],
        semesterChips: [],
        activeSemesterId: "all",
        semesterInitialized: false,
        loaded: false,
        errorMessage: "",
        searchFocused: false,
        queryText: "",
      });
    }
    hydratedGradesAccount = account;
    const cached = loadGradesSnapshotForPreference(
      account,
      this.data.includeUnsuccessful,
    );
    if (!cached) return;
    const semester = this.initializeLatestSemester(cached.data);
    this.applyGradesData(
      semester ? gradesForSemester(cached.data, semester) : cached.data,
      cached.serverFetchedAt,
    );
  },
  syncActiveGradesRefresh(): boolean {
    const lease = captureSessionLease();
    const flight = lease
      ? findRefreshFlight<GradesRefreshOutcome>(gradesRefreshFlightKey(lease))
      : null;
    if (!lease || !flight) {
      if (this.data.refreshing || this.data.observedRefreshFlightId) {
        this.setData({ refreshing: false, observedRefreshFlightId: 0 });
      }
      return false;
    }
    this.observeGradesRefresh(flight, lease);
    return true;
  },
  observeGradesRefresh(
    flight: RefreshFlight<GradesRefreshOutcome>,
    lease: SessionLease,
  ) {
    if (this.data.observedRefreshFlightId === flight.id) {
      if (!this.data.refreshing) this.setData({ refreshing: true });
      return;
    }
    const refreshPageToken = this.data.refreshPageToken;
    this.setData({ refreshing: true, observedRefreshFlightId: flight.id });
    void flight.completion.then((outcome) => {
      if (
        !isRefreshPageVisible(refreshPageToken) ||
        this.data.refreshPageToken !== refreshPageToken ||
        !isSessionLeaseCurrent(lease)
      ) {
        return;
      }
      this.setData({
        loading: false,
        refreshing: false,
        loadingMore: false,
        observedRefreshFlightId: 0,
      });
      if (
        outcome.input.includeUnsuccessful !==
        loadPreferences().showGradesBelow60
      ) {
        void this.loadGrades(true, false);
        return;
      }
      if (!outcome.succeeded || !outcome.result) {
        if (outcome.showFailureFeedback) showRefreshFailure(this);
        if (outcome.errorMessage) {
          this.setData({ errorMessage: outcome.errorMessage });
        }
        return;
      }
      const input = outcome.input;
      this.setData({
        academicYear: input.academicYear,
        term: input.term,
        queryText: input.queryText,
        sort: input.sort,
        order: input.order,
        sortMode: input.sortMode,
        sortLabel: SORT_CONFIG[input.sortMode].label,
        includeUnsuccessful: input.includeUnsuccessful,
        semesterInitialized: Boolean(input.academicYear && input.term),
        activeSemesterId:
          input.academicYear && input.term
            ? `${input.academicYear}-${input.term}`
            : "all",
        errorMessage: "",
      });
      const initializedSemester = this.initializeLatestSemester(
        outcome.result.data,
      );
      this.applyGradesData(
        initializedSemester
          ? gradesForSemester(outcome.result.data, initializedSemester)
          : outcome.result.data,
        outcome.result.meta.fetchedAt,
      );
      showRefreshConfirmation(this);
    });
  },
  buildFilterLabel(semesters?: AcademicSemesterOption[]): string {
    const semester = (semesters || this.data.availableSemesters).find(
      (item) =>
        item.academicYear === this.data.academicYear &&
        item.term === this.data.term,
    );
    return semester?.label || "全部成绩";
  },
  applyGradesData(data: GradesData, fetchedAtValue = "", append = false) {
    const fetchedAt = fetchedAtValue ? formatDateTime(fetchedAtValue) : "";
    const animateEntries = gradeListAnimationRequested;
    if (animateEntries) {
      gradeRenderBatch += 1;
      gradeListAnimationRequested = false;
    }
    const animatedIds = new Set(
      this.data.gradeItems
        .filter((item) => item.animateEntry)
        .map((item) => item.id),
    );
    const incoming = data.items.map((course, index) =>
      toGradeView(
        course,
        `${gradeRenderBatch}:${course.id}:${index}`,
        animateEntries || animatedIds.has(course.id),
        index < 8 ? index * 45 : 0,
      ),
    );
    this.setData({
      gradeItems: append ? [...this.data.gradeItems, ...incoming] : incoming,
      summary: data.summary,
      averageRingSource: progressRingSource(
        data.summary.weightedAverage,
        this.data.motionClass !== "motion-reduced",
      ),
      averageLabel: displayAverage(data.summary.weightedAverage),
      gradePointAverageLabel: displayAverage(data.summary.gradePointAverage),
      page: data.pagination.page,
      totalPages: data.pagination.totalPages,
      total: data.pagination.total,
      availableSemesters: data.semesters,
      semesterChips: buildSemesterChips(data.semesters),
      activeSemesterId:
        this.data.academicYear && this.data.term
          ? `${this.data.academicYear}-${this.data.term}`
          : "all",
      loaded: true,
      loading: false,
      sourceLabel: fetchedAt ? `最后更新于 ${fetchedAt}` : "尚未更新",
      filterLabel: this.buildFilterLabel(data.semesters),
    });
  },
  async loadGrades(reset: boolean, refresh: boolean): Promise<boolean> {
    if (
      !reset &&
      (this.data.loading || this.data.loadingMore || this.data.refreshing)
    ) {
      return false;
    }
    const lease = captureSessionLease();
    if (!lease) return false;
    if (refresh) {
      const activeRefresh = findRefreshFlight<GradesRefreshOutcome>(
        gradesRefreshFlightKey(lease),
      );
      if (activeRefresh) {
        this.observeGradesRefresh(activeRefresh, lease);
        return (await activeRefresh.completion).succeeded;
      }
    }
    const page = reset ? 1 : this.data.page + 1;
    const academicYear = this.data.academicYear;
    const term = this.data.term;
    const queryText = this.data.queryText.trim();
    const sort = this.data.sort;
    const order = this.data.order;
    const loadCanonical =
      reset && !refresh && !queryText && sort === "default" && order === "desc";
    const sequence = ++requestSequence;
    this.setData({
      loading: reset && !this.data.gradeItems.length,
      refreshing: refresh,
      loadingMore: !reset,
      errorMessage: "",
    });

    let shouldRefreshAfterward = false;
    let loadInitializedSemester = false;
    let reloadAfterAutomaticRefresh = false;
    try {
      const result = await getGrades({
        page,
        pageSize: PAGE_SIZE,
        academicYear:
          refresh || loadCanonical ? undefined : academicYear || undefined,
        term: refresh
          ? undefined
          : loadCanonical
            ? undefined
            : ((term || undefined) as 1 | 2 | 3 | undefined),
        q: refresh || loadCanonical ? undefined : queryText || undefined,
        sort: refresh || loadCanonical ? "default" : sort,
        order: refresh || loadCanonical ? "desc" : order,
        includeUnsuccessful: this.data.includeUnsuccessful,
        refresh,
        automatic: refresh,
      });
      if (sequence !== requestSequence || !isSessionLeaseCurrent(lease)) {
        return false;
      }

      const account = lease.account;
      const canonical = page === 1 && (refresh || loadCanonical);
      const local = loadGradesSnapshotForPreference(
        account,
        this.data.includeUnsuccessful,
      );
      if (canonical && shouldStoreServerSnapshot(local, result.meta, refresh)) {
        saveGradesSnapshot(
          account,
          result.data,
          result.meta.fetchedAt,
          this.data.includeUnsuccessful,
        );
      }
      if (refresh) {
        reloadAfterAutomaticRefresh = isUpstreamRefreshResult(result.meta);
        return reloadAfterAutomaticRefresh;
      }

      const initializedSemester = this.initializeLatestSemester(result.data);
      const selectedSemester =
        initializedSemester ||
        result.data.semesters.find(
          (item) =>
            item.academicYear === this.data.academicYear &&
            item.term === this.data.term,
        ) ||
        null;
      if (selectedSemester) {
        this.applyGradesData(
          gradesForSemester(result.data, selectedSemester),
          result.meta.fetchedAt,
        );
        loadInitializedSemester = Boolean(initializedSemester);
      } else {
        this.applyGradesData(
          result.data,
          result.meta.fetchedAt,
          !reset && page > 1,
        );
      }

      shouldRefreshAfterward =
        !refresh &&
        isCacheStale(loadGradesSnapshot(account), FIFTEEN_DAYS_MS) &&
        claimAutomaticRefresh("grades", account);
      return true;
    } catch (error) {
      if (sequence === requestSequence && isSessionLeaseCurrent(lease)) {
        this.setData({
          errorMessage: getErrorMessage(error, "成绩加载失败。"),
        });
      }
      return false;
    } finally {
      if (sequence === requestSequence && isSessionLeaseCurrent(lease)) {
        this.setData({ loading: false, refreshing: false, loadingMore: false });
        if (reloadAfterAutomaticRefresh) {
          setTimeout(() => {
            if (isSessionLeaseCurrent(lease)) {
              void this.loadGrades(true, false);
            }
          }, 0);
        } else if (loadInitializedSemester) {
          setTimeout(() => {
            if (isSessionLeaseCurrent(lease)) {
              void this.loadGrades(true, shouldRefreshAfterward);
            }
          }, 0);
        } else if (shouldRefreshAfterward) {
          setTimeout(() => {
            if (isSessionLeaseCurrent(lease)) {
              void this.loadGrades(true, true);
            }
          }, 0);
        }
      }
    }
  },
  onRefresh() {
    if (this.data.refreshing) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const input: GradesRefreshInput = {
      academicYear: this.data.academicYear,
      term: this.data.term,
      queryText: this.data.queryText.trim(),
      sort: this.data.sort,
      order: this.data.order,
      sortMode: this.data.sortMode,
      includeUnsuccessful: this.data.includeUnsuccessful,
    };
    const { flight, started } = startRefreshFlight(
      gradesRefreshFlightKey(lease),
      () => refreshGrades(lease, input),
    );
    this.observeGradesRefresh(flight, lease);
    if (started) {
      requestSequence += 1;
      haptic("medium");
    }
  },
  selectSemesterQuick(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) return;
    if (id === this.data.activeSemesterId) return;
    haptic("light");
    const chip = this.data.semesterChips.find((item) => item.id === id);
    if (!chip) return;
    this.setData(
      {
        academicYear: chip.academicYear,
        term: chip.term,
        activeSemesterId: chip.id,
        filterLabel: chip.label,
      },
      () => {
        void this.loadGrades(true, false);
      },
    );
  },
  loadMore() {
    if (this.data.page < this.data.totalPages) {
      void this.loadGrades(false, false);
    }
  },
  onQueryInput(event: WechatMiniprogram.Input) {
    this.setData({ queryText: event.detail.value });
  },
  onSearchFocus() {
    this.setData({ searchFocused: true });
  },
  onSearchBlur() {
    this.setData({ searchFocused: false });
  },
  search() {
    void this.loadGrades(true, false);
  },
  clearSearch() {
    this.setData({ queryText: "" });
    void this.loadGrades(true, false);
  },
  openFilter() {
    haptic("light");
    wx.createSelectorQuery()
      .select(".grade-filter-button")
      .boundingClientRect((rect) => {
        const filter = this.selectComponent(
          "#grade-sort-filter",
        ) as unknown as GradeSortFilterController | null;
        filter?.toggle({
          bottom: Number(rect?.bottom),
          right: Number(rect?.right),
        });
      })
      .exec();
  },
  selectSortMode(
    event: WechatMiniprogram.CustomEvent<{ value: GradeSortMode }>,
  ) {
    const mode = String(event.detail.value) as GradeSortMode;
    const config = SORT_CONFIG[mode];
    if (!config || mode === this.data.sortMode) return;
    gradeListAnimationRequested = true;
    this.setData({
      sortMode: mode,
      sort: config.sort,
      order: config.order,
      sortLabel: config.label,
    });
    wx.nextTick(() => void this.loadGrades(true, false));
  },
  onGradeTouchStart(event: WechatMiniprogram.TouchEvent) {
    gradeTouchStart = touchPoint(event);
    gradeTouchMoved = false;
  },
  onGradeTouchMove(event: WechatMiniprogram.TouchEvent) {
    const current = touchPoint(event);
    if (
      gradeTouchStart &&
      current &&
      movementExceedsTapThreshold(gradeTouchStart, current)
    ) {
      gradeTouchMoved = true;
    }
  },
  onGradeTouchEnd(event: WechatMiniprogram.TouchEvent) {
    const current = touchPoint(event, true);
    if (
      gradeTouchStart &&
      current &&
      movementExceedsTapThreshold(gradeTouchStart, current)
    ) {
      gradeTouchMoved = true;
    }
    gradeTouchStart = null;
  },
  onGradeTouchCancel() {
    gradeTouchStart = null;
    gradeTouchMoved = true;
  },
  onGradeScroll() {
    lastGradeScrollAt = Date.now();
    if (gradeTouchStart) gradeTouchMoved = true;
  },
  openGrade(event: WechatMiniprogram.TouchEvent) {
    const canOpen = canActivateTap(gradeTouchMoved, lastGradeScrollAt);
    gradeTouchStart = null;
    gradeTouchMoved = false;
    if (!canOpen) return;
    const key = String(event.currentTarget.dataset.key || "");
    const grade = this.data.gradeItems.find((item) => item.renderKey === key);
    if (!grade) return;
    haptic("light");
    getApp<IAppOption>().globalData.selectedGrade = grade;
    void navigateTo(
      `/features/pages/grade-detail/index?id=${encodeURIComponent(grade.id)}`,
      "wx://cupertino-modal",
    );
  },
});
