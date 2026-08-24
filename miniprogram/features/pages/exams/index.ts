import { getExams } from "../../../services/teaching";
import { getErrorMessage } from "../../../services/request";
import {
  isExamAutomaticRefreshDue,
  refreshExamsOnForeground,
} from "../../../services/cache-refresh";
import { shouldUseServerSnapshot } from "../../../store/cache-policy";
import { loadExamsSnapshot, saveExamsSnapshot } from "../../../store/exams";
import {
  captureSessionLease,
  getSession,
  isSessionLeaseCurrent,
  sessionLeaseKey,
  type SessionLease,
} from "../../../store/session";
import type {
  AcademicSemesterOption,
  Exam,
  ExamsData,
  ExamsQuery,
} from "../../../types/api";
import { resolveAppearance } from "../../../utils/appearance";
import {
  formatDateTime,
  formatFriendlyDate,
  formatTimestampDate,
  formatTimestampTime,
  localDateKey,
} from "../../../utils/date";
import { haptic } from "../../../utils/haptics";
import { ensureAuthenticated } from "../../../utils/navigation";
import {
  createRefreshPageToken,
  findRefreshFlight,
  isRefreshPageVisible,
  markRefreshPageHidden,
  markRefreshPageVisible,
  startRefreshFlight,
  type RefreshFlight,
} from "../../../utils/refresh-flight";
import { showRefreshConfirmation } from "../../../utils/refresh-feedback";
import {
  examBatchLabel,
  examCountdown,
  summarizeExamProgress,
  type ExamCountdownTone,
} from "../../../utils/exams";
import { numberedAcademicSemesterLabel } from "../../../utils/semester";

interface ExamView extends Exam {
  dateLabel: string;
  timeLabel: string;
  countdownLabel: string;
  countdownTone: ExamCountdownTone;
  locationLabel: string;
  teachersLabel: string;
  classLabel: string;
  creditsLabel: string;
  methodLabel: string;
  batchLabel: string;
  retakeMarker: boolean;
  makeupDeferredMarker: boolean;
}

interface SemesterChip extends AcademicSemesterOption {
  selectorLabel: string;
}

interface SelectedExamDetail {
  rows: Array<{ label: string; value: string }>;
  note: string;
}

interface ExamsRefreshInput {
  semesterId: string;
}

interface ExamsRefreshOutcome {
  succeeded: boolean;
  input: ExamsRefreshInput;
  result: Awaited<ReturnType<typeof getExams>> | null;
  errorMessage: string;
}

type ExamListSlideDirection = "from-left" | "from-right" | "";

const PAGE_SIZE = 50;
let examsSequence = 0;
let hydratedExamsAccount = "";
let pendingExamListSlideDirection: ExamListSlideDirection = "";
let examListSlideSequence = 0;

function nextExamListSlideClass(
  direction: Exclude<ExamListSlideDirection, "">,
): string {
  examListSlideSequence += 1;
  const phase = examListSlideSequence % 2 ? "a" : "b";
  return `exam-list--${direction}-${phase}`;
}

function examsRefreshFlightKey(lease: SessionLease): string {
  return `exams:${sessionLeaseKey(lease)}`;
}

async function refreshExams(
  lease: SessionLease,
  input: ExamsRefreshInput,
): Promise<ExamsRefreshOutcome> {
  try {
    const result = await getExams({
      semester: input.semesterId || undefined,
      page: 1,
      pageSize: PAGE_SIZE,
      refresh: true,
    });
    if (!isSessionLeaseCurrent(lease)) {
      return { succeeded: false, input, result: null, errorMessage: "" };
    }
    const storageSemester = input.semesterId || "default";
    const local = loadExamsSnapshot(lease.account, storageSemester);
    saveExamsSnapshot(lease.account, result.data, {
      semesterId: storageSemester,
      serverFetchedAt: result.meta.fetchedAt,
      lastAutomaticRefreshAt: local?.lastAutomaticRefreshAt || 0,
    });
    return { succeeded: true, input, result, errorMessage: "" };
  } catch (error) {
    return {
      succeeded: false,
      input,
      result: null,
      errorMessage: getErrorMessage(error, "考试信息加载失败。"),
    };
  }
}

function buildSemesterChips(
  semesters: AcademicSemesterOption[],
): SemesterChip[] {
  return semesters.map((semester) => ({
    ...semester,
    selectorLabel: numberedAcademicSemesterLabel(semester),
  }));
}

function toExamView(exam: Exam): ExamView {
  const countdown = examCountdown(exam);
  const dateLabel = exam.time.startAt
    ? formatTimestampDate(exam.time.startAt)
    : exam.time.date
      ? formatFriendlyDate(exam.time.date)
      : "日期待定";
  let timeLabel =
    exam.time.startTime && exam.time.endTime
      ? `${exam.time.startTime}–${exam.time.endTime}`
      : exam.time.raw || "时间待定";
  if (exam.time.startAt) {
    const start = formatTimestampTime(exam.time.startAt);
    if (exam.time.endAt) {
      const end =
        localDateKey(exam.time.startAt) === localDateKey(exam.time.endAt)
          ? formatTimestampTime(exam.time.endAt)
          : formatDateTime(exam.time.endAt);
      timeLabel = `${start}–${end}`;
    } else {
      timeLabel = start;
    }
  }
  return {
    ...exam,
    arrangementType: exam.arrangementType || "regular",
    arrangementTypeLabel: exam.arrangementTypeLabel || "正常考试",
    dateLabel,
    timeLabel,
    countdownLabel: countdown.label,
    countdownTone: countdown.tone,
    locationLabel:
      [exam.location.campus, exam.location.room].filter(Boolean).join(" · ") ||
      "考场待定",
    teachersLabel: exam.teacherNames.join("、") || "—",
    classLabel: exam.classComposition.join("、") || exam.teachingClass || "—",
    creditsLabel:
      exam.course.credits === undefined ? "—" : `${exam.course.credits}`,
    methodLabel: exam.method || "未说明",
    batchLabel: examBatchLabel(exam),
    retakeMarker: exam.retake === true,
    makeupDeferredMarker: exam.examName.includes("补缓考"),
  };
}

function makeExamDetail(exam: ExamView): SelectedExamDetail {
  return {
    rows: [
      { label: "考试批次", value: exam.batchLabel },
      { label: "考试时间", value: `${exam.dateLabel} ${exam.timeLabel}` },
      { label: "考场", value: exam.locationLabel },
      { label: "考试方式", value: exam.methodLabel },
      { label: "课程代码", value: exam.course.code || "—" },
      {
        label: "课程学分",
        value: exam.creditsLabel === "—" ? "—" : `${exam.creditsLabel} 学分`,
      },
      { label: "教学班", value: exam.teachingClass || "—" },
      { label: "组成班级", value: exam.classLabel },
      { label: "开课学院", value: exam.department || "—" },
      { label: "任课教师", value: exam.teachersLabel },
    ],
    note: exam.note || "",
  };
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
    semesterId: "",
    semesters: [] as SemesterChip[],
    examItems: [] as ExamView[],
    statusSummary: { total: 0, pending: 0, past: 0 },
    page: 1,
    totalPages: 0,
    total: 0,
    examListSlideClass: "",
    filterLabel: "最新学期",
    selectedExamVisible: false,
    selectedExamTitle: "考试详情",
    selectedExamDetailHeight: 0,
    selectedExam: null as SelectedExamDetail | null,
    refreshPageToken: 0,
    observedRefreshFlightId: 0,
  },
  onLoad() {
    hydratedExamsAccount = "";
    pendingExamListSlideDirection = "";
    examListSlideSequence = 0;
    examsSequence += 1;
    const refreshPageToken = createRefreshPageToken();
    markRefreshPageVisible(refreshPageToken);
    this.setData({ refreshPageToken });
    this.applyAppearance();
    this.syncActiveExamsRefresh();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    markRefreshPageVisible(this.data.refreshPageToken);
    this.applyAppearance();
    this.hydrateExams();
    if (!this.syncActiveExamsRefresh()) {
      void this.loadExams(true, false);
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
  hydrateExams(semesterId = "default"): boolean {
    const account = getSession()?.user.account || "";
    if (!account) return false;
    if (hydratedExamsAccount && hydratedExamsAccount !== account) {
      examsSequence += 1;
      this.setData({
        loading: false,
        refreshing: false,
        loadingMore: false,
        semesterId: "",
        semesters: [],
        examItems: [],
        statusSummary: { total: 0, pending: 0, past: 0 },
        page: 1,
        totalPages: 0,
        total: 0,
        examListSlideClass: "",
        filterLabel: "最新学期",
        selectedExamVisible: false,
        selectedExamTitle: "考试详情",
        selectedExamDetailHeight: 0,
        selectedExam: null,
        loaded: false,
        errorMessage: "",
      });
    }
    if (
      semesterId === "default" &&
      hydratedExamsAccount === account &&
      this.data.loaded
    ) {
      return true;
    }
    hydratedExamsAccount = account;
    const cached = loadExamsSnapshot(account, semesterId);
    if (!cached) return false;
    this.applyExamsData(cached.data);
    return true;
  },
  syncActiveExamsRefresh(): boolean {
    const lease = captureSessionLease();
    const flight = lease
      ? findRefreshFlight<ExamsRefreshOutcome>(examsRefreshFlightKey(lease))
      : null;
    if (!lease || !flight) {
      if (this.data.refreshing || this.data.observedRefreshFlightId) {
        this.setData({ refreshing: false, observedRefreshFlightId: 0 });
      }
      return false;
    }
    this.observeExamsRefresh(flight, lease);
    return true;
  },
  observeExamsRefresh(
    flight: RefreshFlight<ExamsRefreshOutcome>,
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
      if (!outcome.succeeded || !outcome.result) {
        if (outcome.errorMessage) {
          this.setData({ errorMessage: outcome.errorMessage });
        }
        return;
      }
      this.applyExamsData(outcome.result.data);
      this.setData({ errorMessage: "" });
      showRefreshConfirmation(this);
    });
  },
  applyExamsData(data: ExamsData) {
    const semesterId = data.semester?.id || "";
    const examItems = data.items.map(toExamView);
    let examListSlideClass = this.data.examListSlideClass;
    if (
      pendingExamListSlideDirection &&
      semesterId === this.data.semesterId
    ) {
      examListSlideClass = nextExamListSlideClass(
        pendingExamListSlideDirection,
      );
      pendingExamListSlideDirection = "";
    }
    this.setData({
      examItems,
      semesters: buildSemesterChips(data.semesters),
      semesterId,
      statusSummary: summarizeExamProgress(examItems, data.summary.total),
      page: data.pagination.page,
      totalPages: data.pagination.totalPages,
      total: data.pagination.total,
      examListSlideClass,
      loaded: true,
      loading: false,
      filterLabel: data.semester
        ? numberedAcademicSemesterLabel(data.semester)
        : "暂无可用学期",
    });
  },
  async loadExams(reset: boolean, refresh: boolean): Promise<boolean> {
    if (
      (this.data.loading || this.data.loadingMore) &&
      this.data.loaded &&
      !refresh
    ) {
      return false;
    }
    const lease = captureSessionLease();
    if (!lease) return false;
    if (refresh) {
      const activeRefresh = findRefreshFlight<ExamsRefreshOutcome>(
        examsRefreshFlightKey(lease),
      );
      if (activeRefresh) {
        this.observeExamsRefresh(activeRefresh, lease);
        return (await activeRefresh.completion).succeeded;
      }
    }
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++examsSequence;
    this.setData({
      loading: reset && !this.data.loaded,
      refreshing: refresh,
      loadingMore: !reset,
      errorMessage: "",
    });
    const query: ExamsQuery = {
      semester: this.data.semesterId || undefined,
      page,
      pageSize: PAGE_SIZE,
      refresh,
    };
    let shouldRefreshAfterward = false;
    try {
      const result = await getExams(query);
      if (sequence !== examsSequence || !isSessionLeaseCurrent(lease)) {
        return false;
      }
      const account = lease.account;
      const storageSemester = query.semester || "default";
      const local = loadExamsSnapshot(account, storageSemester);
      if (
        !reset ||
        refresh ||
        shouldUseServerSnapshot(local, result.meta.fetchedAt)
      ) {
        const lastAutomaticRefreshAt = local?.lastAutomaticRefreshAt || 0;
        if (reset) {
          saveExamsSnapshot(account, result.data, {
            semesterId: storageSemester,
            serverFetchedAt: result.meta.fetchedAt,
            lastAutomaticRefreshAt,
          });
          this.applyExamsData(result.data);
        } else {
          const examItems = [
            ...this.data.examItems,
            ...result.data.items.map(toExamView),
          ];
          this.setData({
            examItems,
            statusSummary: summarizeExamProgress(
              examItems,
              result.data.summary.total,
            ),
            page: result.data.pagination.page,
            totalPages: result.data.pagination.totalPages,
            total: result.data.pagination.total,
          });
        }
      }
      const current = loadExamsSnapshot(account, storageSemester);
      shouldRefreshAfterward =
        !refresh &&
        Boolean(lease.signedInAt) &&
        isExamAutomaticRefreshDue(current?.lastAutomaticRefreshAt || 0);
      return true;
    } catch (error) {
      if (sequence === examsSequence && isSessionLeaseCurrent(lease)) {
        const message = getErrorMessage(error, "考试信息加载失败。");
        if (message && this.data.examItems.length) {
          wx.showToast({ title: message, icon: "none" });
        } else if (message) {
          this.setData({ errorMessage: message });
        }
      }
      return false;
    } finally {
      if (sequence === examsSequence && isSessionLeaseCurrent(lease)) {
        this.setData({ loading: false, refreshing: false, loadingMore: false });
        if (shouldRefreshAfterward) {
          void refreshExamsOnForeground().then((snapshot) => {
            if (
              !snapshot ||
              sequence !== examsSequence ||
              !isSessionLeaseCurrent(lease)
            ) {
              return;
            }
            const currentSemester = this.data.semesterId;
            const refreshedSemester = snapshot.data.semester?.id || "";
            if (!currentSemester || currentSemester === refreshedSemester) {
              this.applyExamsData(snapshot.data);
            }
          });
        }
      }
    }
  },
  onRefresh() {
    if (this.data.refreshing) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const input: ExamsRefreshInput = { semesterId: this.data.semesterId };
    const { flight, started } = startRefreshFlight(
      examsRefreshFlightKey(lease),
      () => refreshExams(lease, input),
    );
    this.observeExamsRefresh(flight, lease);
    if (started) {
      examsSequence += 1;
      haptic("medium");
    }
  },
  loadMore() {
    if (this.data.page < this.data.totalPages) {
      void this.loadExams(false, false);
    }
  },
  selectSemesterQuick(event: WechatMiniprogram.TouchEvent) {
    const semesterId = String(event.currentTarget.dataset.id || "");
    if (!semesterId || semesterId === this.data.semesterId) return;
    const semester = this.data.semesters.find((item) => item.id === semesterId);
    if (!semester) return;
    const currentIndex = this.data.semesters.findIndex(
      (item) => item.id === this.data.semesterId,
    );
    const targetIndex = this.data.semesters.findIndex(
      (item) => item.id === semesterId,
    );
    pendingExamListSlideDirection =
      currentIndex >= 0 && targetIndex < currentIndex
        ? "from-left"
        : "from-right";
    haptic("medium");
    this.setData({
      semesterId,
      filterLabel: semester.selectorLabel,
    });
    if (!this.hydrateExams(semesterId)) {
      this.setData({
        loading: false,
        errorMessage: "",
      });
    }
    void this.loadExams(true, false);
  },
  openExam(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    const exam = this.data.examItems.find((item) => item.id === id);
    if (!exam) return;
    haptic("light");
    this.setData(
      {
        selectedExam: makeExamDetail(exam),
        selectedExamTitle: exam.course.name,
        selectedExamDetailHeight: 0,
        selectedExamVisible: true,
      },
      () => {
        wx.nextTick(() => wx.nextTick(() => this.measureExamDetailHeight()));
      },
    );
  },
  measureExamDetailHeight(attempt = 0) {
    this.createSelectorQuery()
      .select("#exam-detail-content")
      .boundingClientRect((rect) => {
        const contentHeight = Math.ceil(Number(rect?.height) || 0);
        if (!contentHeight) {
          if (attempt < 2 && this.data.selectedExamVisible) {
            wx.nextTick(() => this.measureExamDetailHeight(attempt + 1));
          }
          return;
        }
        const windowInfo = wx.getWindowInfo();
        const windowHeight = Math.max(1, windowInfo.windowHeight || 667);
        const windowWidth = Math.max(1, windowInfo.windowWidth || 375);
        const safeBottom = Math.max(
          0,
          windowHeight - Number(windowInfo.safeArea?.bottom || windowHeight),
        );
        const sheetChromeHeight = (130 * windowWidth) / 750 + safeBottom;
        const maximumHeight = Math.max(
          1,
          Math.floor(windowHeight * 0.86 - sheetChromeHeight),
        );
        const selectedExamDetailHeight = Math.min(contentHeight, maximumHeight);
        if (
          this.data.selectedExamVisible &&
          selectedExamDetailHeight !== this.data.selectedExamDetailHeight
        ) {
          this.setData({ selectedExamDetailHeight });
        }
      })
      .exec();
  },
  closeExam() {
    this.setData({ selectedExamVisible: false });
  },
});
