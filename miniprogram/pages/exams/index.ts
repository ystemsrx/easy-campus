import { getExamOptions, getExams } from "../../services/teaching";
import { getErrorMessage } from "../../services/request";
import type { Exam, ExamOption, ExamsQuery, TermOption } from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import {
  academicYearLabel,
  formatDateTime,
  formatFriendlyDate,
  formatTimestampDate,
  formatTimestampTime,
  getDefaultAcademicPeriod,
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

interface AcademicYearOption extends ExamOption {
  numericValue: number;
}

const PAGE_SIZE = 50;
let optionsSequence = 0;
let examsSequence = 0;

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
      { label: "考试名称", value: exam.examName || "—" },
      { label: "考试时间", value: `${exam.dateLabel} ${exam.timeLabel}` },
      { label: "考场", value: exam.locationLabel },
      { label: "座位号", value: exam.seatLabel },
      { label: "考试方式", value: exam.methodLabel },
      { label: "补考/重修", value: exam.retakeLabel },
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
    optionsLoading: true,
    loading: true,
    refreshing: false,
    loadingMore: false,
    errorMessage: "",
    loaded: false,
    searchFocused: false,
    queryText: "",
    academicYear: getDefaultAcademicPeriod().academicYear,
    term: getDefaultAcademicPeriod().term,
    startDate: "",
    endDate: "",
    examNameId: "",
    departmentId: "",
    order: "asc" as "asc" | "desc",
    academicYears: [] as AcademicYearOption[],
    terms: [] as TermOption[],
    examNames: [] as ExamOption[],
    departments: [] as ExamOption[],
    examItems: [] as ExamView[],
    page: 1,
    totalPages: 1,
    total: 0,
    filterLabel: `${academicYearLabel(getDefaultAcademicPeriod().academicYear)} · 第 ${getDefaultAcademicPeriod().term} 学期`,
    filterVisible: false,
    draftAcademicYear: getDefaultAcademicPeriod().academicYear,
    draftTerm: getDefaultAcademicPeriod().term,
    draftStartDate: "",
    draftEndDate: "",
    draftExamNameId: "",
    draftDepartmentId: "",
    draftOrder: "asc" as "asc" | "desc",
    selectedExamVisible: false,
    selectedExam: null as SelectedExamDetail | null,
  },
  onLoad() {
    this.applyAppearance();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.applyAppearance();
    if (!this.data.loaded) {
      void this.initialize();
    }
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
  buildFilterLabel(): string {
    const parts = [
      academicYearLabel(this.data.academicYear),
      `第 ${this.data.term} 学期`,
    ];
    if (this.data.startDate || this.data.endDate) {
      parts.push(
        `${this.data.startDate || "不限"} 至 ${this.data.endDate || "不限"}`,
      );
    }
    return parts.join(" · ");
  },
  async initialize() {
    await this.loadOptions(this.data.academicYear, this.data.term);
    await this.loadExams(true, false);
  },
  async loadOptions(academicYear: number, term: 1 | 2 | 3) {
    const sequence = ++optionsSequence;
    this.setData({ optionsLoading: true, errorMessage: "" });
    try {
      const result = await getExamOptions(academicYear, term);
      if (sequence !== optionsSequence) return;
      const rawAcademicYears = result.data.academicYears.length
        ? result.data.academicYears
        : [
            {
              value: String(academicYear),
              label: academicYearLabel(academicYear),
            },
          ];
      const academicYears = rawAcademicYears.map((item) => ({
        ...item,
        numericValue: Number(item.value),
      }));
      this.setData({
        academicYears,
        terms: result.data.terms,
        examNames: result.data.examNames,
        departments: result.data.departments,
      });
    } catch (error) {
      if (sequence === optionsSequence) {
        this.setData({
          errorMessage: getErrorMessage(error, "考试筛选选项加载失败。"),
        });
      }
    } finally {
      if (sequence === optionsSequence) this.setData({ optionsLoading: false });
    }
  },
  async loadExams(reset: boolean, refresh: boolean) {
    if (
      (this.data.loading || this.data.loadingMore) &&
      this.data.loaded &&
      !refresh
    )
      return;
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++examsSequence;
    this.setData({
      loading: reset && !this.data.examItems.length,
      refreshing: refresh,
      loadingMore: !reset,
      errorMessage: "",
    });
    const query: ExamsQuery = {
      academicYear: this.data.academicYear,
      term: this.data.term,
      startDate: this.data.startDate || undefined,
      endDate: this.data.endDate || undefined,
      q: this.data.queryText.trim() || undefined,
      examNameId: this.data.examNameId || undefined,
      departmentId: this.data.departmentId || undefined,
      order: this.data.order,
      page,
      pageSize: PAGE_SIZE,
      refresh,
    };
    try {
      const result = await getExams(query);
      if (sequence !== examsSequence) return;
      const incoming = result.data.items.map(toExamView);
      this.setData({
        examItems: reset ? incoming : [...this.data.examItems, ...incoming],
        page: result.data.pagination.page,
        totalPages: result.data.pagination.totalPages,
        total: result.data.pagination.total,
        loaded: true,
        filterLabel: this.buildFilterLabel(),
      });
    } catch (error) {
      if (sequence === examsSequence) {
        this.setData({
          errorMessage: getErrorMessage(error, "考试信息加载失败。"),
        });
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
    if (this.data.page < this.data.totalPages)
      void this.loadExams(false, false);
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
    void this.loadExams(true, false);
  },
  clearSearch() {
    this.setData({ queryText: "" });
    void this.loadExams(true, false);
  },
  openFilter() {
    haptic("light");
    this.setData({
      filterVisible: true,
      draftAcademicYear: this.data.academicYear,
      draftTerm: this.data.term,
      draftStartDate: this.data.startDate,
      draftEndDate: this.data.endDate,
      draftExamNameId: this.data.examNameId,
      draftDepartmentId: this.data.departmentId,
      draftOrder: this.data.order,
    });
  },
  closeFilter() {
    this.setData({ filterVisible: false });
  },
  selectDraftYear(event: WechatMiniprogram.TouchEvent) {
    haptic("light");
    this.setData({
      draftAcademicYear: Number(event.currentTarget.dataset.value),
    });
  },
  selectDraftTerm(event: WechatMiniprogram.TouchEvent) {
    haptic("light");
    this.setData({
      draftTerm: Number(event.currentTarget.dataset.value) as 1 | 2 | 3,
    });
  },
  onDraftStartDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ draftStartDate: event.detail.value });
  },
  onDraftEndDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ draftEndDate: event.detail.value });
  },
  clearDraftStartDate() {
    this.setData({ draftStartDate: "" });
  },
  clearDraftEndDate() {
    this.setData({ draftEndDate: "" });
  },
  selectDraftExamName(event: WechatMiniprogram.TouchEvent) {
    haptic("light");
    this.setData({
      draftExamNameId: String(event.currentTarget.dataset.value),
    });
  },
  selectDraftDepartment(event: WechatMiniprogram.TouchEvent) {
    haptic("light");
    this.setData({
      draftDepartmentId: String(event.currentTarget.dataset.value),
    });
  },
  selectDraftOrder(event: WechatMiniprogram.TouchEvent) {
    haptic("light");
    this.setData({
      draftOrder: String(event.currentTarget.dataset.value) as "asc" | "desc",
    });
  },
  resetFilter() {
    const defaults = getDefaultAcademicPeriod();
    this.setData({
      draftAcademicYear: defaults.academicYear,
      draftTerm: defaults.term,
      draftStartDate: "",
      draftEndDate: "",
      draftExamNameId: "",
      draftDepartmentId: "",
      draftOrder: "asc",
    });
  },
  async applyFilter() {
    if (
      this.data.draftStartDate &&
      this.data.draftEndDate &&
      this.data.draftStartDate > this.data.draftEndDate
    ) {
      wx.showToast({ title: "开始日期不能晚于结束日期", icon: "none" });
      return;
    }
    const periodChanged =
      this.data.draftAcademicYear !== this.data.academicYear ||
      this.data.draftTerm !== this.data.term;
    haptic("medium");
    this.setData({
      academicYear: this.data.draftAcademicYear,
      term: this.data.draftTerm,
      startDate: this.data.draftStartDate,
      endDate: this.data.draftEndDate,
      examNameId: periodChanged ? "" : this.data.draftExamNameId,
      departmentId: periodChanged ? "" : this.data.draftDepartmentId,
      order: this.data.draftOrder,
      filterVisible: false,
      examItems: periodChanged ? [] : this.data.examItems,
    });
    if (periodChanged) {
      await this.loadOptions(this.data.draftAcademicYear, this.data.draftTerm);
    }
    await this.loadExams(true, false);
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
