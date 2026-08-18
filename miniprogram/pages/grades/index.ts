import { getGrades } from "../../services/teaching";
import { getErrorMessage } from "../../services/request";
import {
  claimAutomaticRefresh,
  isCacheStale,
  shouldUseServerSnapshot,
  WEEK_MS,
} from "../../store/cache-policy";
import { loadGradesSnapshot, saveGradesSnapshot } from "../../store/grades";
import { getSession } from "../../store/session";
import type {
  AcademicSemesterOption,
  GradeCourse,
  GradeSummary,
  GradesData,
  GradesQuery,
} from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import { formatDateTime } from "../../utils/date";
import { formatCredits, formatScore, scoreTone } from "../../utils/format";
import {
  gradesForSemester,
  isMakeupOrDeferredGrade,
  latestGradedSemester,
} from "../../utils/grades";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated, navigateTo } from "../../utils/navigation";
import { progressRingSource } from "../../utils/progress-ring";
import { numberedAcademicSemesterLabel } from "../../utils/semester";
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

const PAGE_SIZE = 200;
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
    scoreTone: scoreTone(course.finalScore),
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
  },
  onLoad() {
    hydratedGradesAccount = "";
    requestSequence += 1;
    gradeRenderBatch = 0;
    gradeListAnimationRequested = true;
    gradeTouchStart = null;
    gradeTouchMoved = false;
    lastGradeScrollAt = 0;
    this.applyAppearance();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.applyAppearance();
    this.hydrateGrades();
    void this.loadGrades(true, false);
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
    hydratedGradesAccount = account;
    const cached = loadGradesSnapshot(account);
    if (!cached) return;
    const semester = this.initializeLatestSemester(cached.data);
    this.applyGradesData(
      semester ? gradesForSemester(cached.data, semester) : cached.data,
      cached.serverFetchedAt,
    );
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
        `${gradeRenderBatch}:${course.id}`,
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
  async loadGrades(reset: boolean, refresh: boolean) {
    if (
      !reset &&
      (this.data.loading || this.data.loadingMore || this.data.refreshing)
    ) {
      return;
    }
    const page = reset ? 1 : this.data.page + 1;
    const academicYear = this.data.academicYear;
    const term = this.data.term;
    const queryText = this.data.queryText.trim();
    const sort = this.data.sort;
    const order = this.data.order;
    const sequence = ++requestSequence;
    this.setData({
      loading: reset && !this.data.gradeItems.length,
      refreshing: refresh,
      loadingMore: !reset,
      errorMessage: "",
    });

    let shouldRefreshAfterward = false;
    let loadInitializedSemester = false;
    try {
      const result = await getGrades({
        page,
        pageSize: PAGE_SIZE,
        academicYear: academicYear || undefined,
        term: (term || undefined) as 1 | 2 | 3 | undefined,
        q: queryText || undefined,
        sort,
        order,
        refresh,
      });
      if (sequence !== requestSequence) return;

      const account = getSession()?.user.account || "";
      const canonical =
        page === 1 &&
        !academicYear &&
        !term &&
        !queryText &&
        sort === "default" &&
        order === "desc";
      const local = loadGradesSnapshot(account);
      if (
        canonical &&
        (refresh || shouldUseServerSnapshot(local, result.meta.fetchedAt))
      ) {
        saveGradesSnapshot(account, result.data, result.meta.fetchedAt);
      }

      const initializedSemester = this.initializeLatestSemester(result.data);
      if (initializedSemester) {
        this.applyGradesData(
          gradesForSemester(result.data, initializedSemester),
          result.meta.fetchedAt,
        );
        loadInitializedSemester = true;
      } else {
        this.applyGradesData(
          result.data,
          result.meta.fetchedAt,
          !reset && page > 1,
        );
      }

      shouldRefreshAfterward =
        !refresh &&
        isCacheStale(loadGradesSnapshot(account), WEEK_MS) &&
        claimAutomaticRefresh("grades", account);
    } catch (error) {
      if (sequence === requestSequence) {
        this.setData({
          errorMessage: getErrorMessage(error, "成绩加载失败。"),
        });
      }
    } finally {
      if (sequence === requestSequence) {
        this.setData({ loading: false, refreshing: false, loadingMore: false });
        if (loadInitializedSemester) {
          setTimeout(
            () => void this.loadGrades(true, shouldRefreshAfterward),
            0,
          );
        } else if (shouldRefreshAfterward) {
          setTimeout(() => void this.loadGrades(true, true), 0);
        }
      }
    }
  },
  onRefresh() {
    if (this.data.refreshing) return;
    haptic("medium");
    void this.loadGrades(true, true);
  },
  selectSemesterQuick(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) return;
    if (id === this.data.activeSemesterId) return;
    haptic("light");
    const chip = this.data.semesterChips.find((item) => item.id === id);
    if (!chip) return;
    this.setData({
      academicYear: chip.academicYear,
      term: chip.term,
      activeSemesterId: chip.id,
    });
    wx.nextTick(() => {
      this.setData({ filterLabel: this.buildFilterLabel() });
      void this.loadGrades(true, false);
    });
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
    const id = String(event.currentTarget.dataset.id || "");
    const grade = this.data.gradeItems.find((item) => item.id === id);
    if (!grade) return;
    haptic("light");
    getApp<IAppOption>().globalData.selectedGrade = grade;
    void navigateTo(
      `/pages/grade-detail/index?id=${encodeURIComponent(id)}`,
      "wx://cupertino-modal",
    );
  },
});
