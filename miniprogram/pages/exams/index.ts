import { getExams } from "../../services/teaching";
import { getErrorMessage } from "../../services/request";
import type {
  AcademicSemesterOption,
  Exam,
  ExamSummary,
  ExamsQuery,
} from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import {
  formatDateTime,
  formatFriendlyDate,
  formatTimestampDate,
  formatTimestampTime,
  localDateKey,
} from "../../utils/date";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated } from "../../utils/navigation";

interface ExamView extends Exam {
  dateLabel: string;
  timeLabel: string;
  locationLabel: string;
  seatLabel: string;
  teachersLabel: string;
  classLabel: string;
  creditsLabel: string;
  methodLabel: string;
  retakeLabel: string;
}

interface SelectedExamDetail {
  title: string;
  rows: Array<{ label: string; value: string }>;
  note: string;
}

const PAGE_SIZE = 50;
let examsSequence = 0;

function emptySummary(): ExamSummary {
  return {
    total: 0,
    regular: 0,
    makeup: 0,
    deferred: 0,
    makeupDeferred: 0,
  };
}

function summaryLabel(summary: ExamSummary): string {
  if (!summary.total) return "本学期暂无考试";
  const parts: string[] = [];
  if (summary.regular) parts.push(`${summary.regular} 场正常考试`);
  if (summary.makeup) parts.push(`${summary.makeup} 场补考`);
  if (summary.deferred) parts.push(`${summary.deferred} 场缓考`);
  if (summary.makeupDeferred) parts.push(`${summary.makeupDeferred} 场补/缓考`);
  return parts.join(" · ");
}

function toExamView(exam: Exam): ExamView {
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
    locationLabel:
      [exam.location.campus, exam.location.room].filter(Boolean).join(" · ") ||
      "考场待定",
    seatLabel: exam.seatNumber || "待定",
    teachersLabel: exam.teacherNames.join("、") || "—",
    classLabel: exam.classComposition.join("、") || exam.teachingClass || "—",
    creditsLabel:
      exam.course.credits === undefined ? "—" : `${exam.course.credits}`,
    methodLabel: exam.method || "未说明",
    retakeLabel: exam.retake === undefined ? "—" : exam.retake ? "是" : "否",
  };
}

function makeExamDetail(exam: ExamView): SelectedExamDetail {
  return {
    title: exam.course.name,
    rows: [
      { label: "考试类型", value: exam.arrangementTypeLabel },
      { label: "教务批次", value: exam.examName || "—" },
      { label: "考试时间", value: `${exam.dateLabel} ${exam.timeLabel}` },
      { label: "考场", value: exam.locationLabel },
      { label: "座位号", value: exam.seatLabel },
      { label: "考试方式", value: exam.methodLabel },
      { label: "重修标记", value: exam.retakeLabel },
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
    headerScrolled: false,
    loading: true,
    refreshing: false,
    loadingMore: false,
    errorMessage: "",
    loaded: false,
    semesterId: "",
    semesters: [] as AcademicSemesterOption[],
    examItems: [] as ExamView[],
    summary: emptySummary(),
    summaryLabel: "正在读取考试安排",
    page: 1,
    totalPages: 0,
    total: 0,
    filterLabel: "最新学期",
    filterVisible: false,
    draftSemesterId: "",
    selectedExamVisible: false,
    selectedExam: null as SelectedExamDetail | null,
  },
  onLoad() {
    this.applyAppearance();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.applyAppearance();
    if (!this.data.loaded) void this.loadExams(true, false);
  },
  applyAppearance() {
    this.setData(resolveAppearance());
  },
  onScroll(event: WechatMiniprogram.ScrollViewScroll) {
    const scrolled = event.detail.scrollTop > 18;
    if (scrolled !== this.data.headerScrolled) {
      this.setData({ headerScrolled: scrolled });
    }
  },
  async loadExams(reset: boolean, refresh: boolean) {
    if (
      (this.data.loading || this.data.loadingMore) &&
      this.data.loaded &&
      !refresh
    ) {
      return;
    }
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++examsSequence;
    this.setData({
      loading: reset && !this.data.loaded,
      refreshing: false,
      loadingMore: !reset,
      errorMessage: "",
    });
    const query: ExamsQuery = {
      semester: this.data.semesterId || undefined,
      page,
      pageSize: PAGE_SIZE,
      refresh,
    };
    try {
      const result = await getExams(query);
      if (sequence !== examsSequence) return;
      const incoming = result.data.items.map(toExamView);
      const semesterId = result.data.semester?.id || "";
      this.setData({
        examItems: reset ? incoming : [...this.data.examItems, ...incoming],
        semesters: result.data.semesters,
        semesterId,
        draftSemesterId: semesterId,
        summary: result.data.summary,
        summaryLabel: summaryLabel(result.data.summary),
        page: result.data.pagination.page,
        totalPages: result.data.pagination.totalPages,
        total: result.data.pagination.total,
        loaded: true,
        filterLabel: result.data.semester?.label || "暂无可用学期",
      });
    } catch (error) {
      if (sequence === examsSequence) {
        const message = getErrorMessage(error, "考试信息加载失败。");
        if (this.data.examItems.length) {
          wx.showToast({ title: message, icon: "none" });
        } else {
          this.setData({ errorMessage: message });
        }
      }
    } finally {
      if (sequence === examsSequence) {
        this.setData({ loading: false, refreshing: false, loadingMore: false });
      }
    }
  },
  onRefresh() {
    haptic("medium");
    void this.loadExams(true, true);
  },
  loadMore() {
    if (this.data.page < this.data.totalPages) {
      void this.loadExams(false, false);
    }
  },
  openFilter() {
    haptic("light");
    this.setData({
      filterVisible: true,
      draftSemesterId: this.data.semesterId,
    });
  },
  closeFilter() {
    this.setData({ filterVisible: false });
  },
  selectDraftSemester(event: WechatMiniprogram.TouchEvent) {
    haptic("light");
    this.setData({
      draftSemesterId: String(event.currentTarget.dataset.id || ""),
    });
  },
  resetFilter() {
    this.setData({ draftSemesterId: this.data.semesters[0]?.id || "" });
  },
  applyFilter() {
    const semesterId = this.data.draftSemesterId;
    if (semesterId === this.data.semesterId) {
      this.closeFilter();
      return;
    }
    haptic("medium");
    this.setData({
      semesterId,
      filterVisible: false,
      examItems: [],
      loaded: false,
      total: 0,
      summary: emptySummary(),
      summaryLabel: "正在读取考试安排",
    });
    void this.loadExams(true, false);
  },
  openExam(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    const exam = this.data.examItems.find((item) => item.id === id);
    if (!exam) return;
    haptic("light");
    this.setData({
      selectedExam: makeExamDetail(exam),
      selectedExamVisible: true,
    });
  },
  closeExam() {
    this.setData({ selectedExamVisible: false });
  },
});
