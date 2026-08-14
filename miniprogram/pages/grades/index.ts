import { getGrades } from "../../services/teaching";
import { getErrorMessage } from "../../services/request";
import type {
  AcademicSemesterOption,
  GradeCourse,
  GradeSummary,
  GradesQuery,
} from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import { academicTermLabel, formatDateTime } from "../../utils/date";
import { formatCredits, formatScore, scoreTone } from "../../utils/format";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated, navigateTo } from "../../utils/navigation";

interface GradeComponentPreview {
  name: string;
  score: string;
}

interface GradeView extends GradeCourse {
  displayScore: string;
  scoreTone: string;
  isTextGrade: boolean;
  creditsLabel: string;
  termLabel: string;
  componentPreview: GradeComponentPreview[];
}

interface YearOption {
  value: number;
  label: string;
}

interface TermOption {
  value: number;
  label: string;
}

interface SemesterChip {
  id: string;
  label: string;
  academicYear: number;
  term: number;
}

const PAGE_SIZE = 50;
let requestSequence = 0;

function toGradeView(course: GradeCourse): GradeView {
  return {
    ...course,
    displayScore: formatScore(course.finalScore),
    scoreTone: scoreTone(course.finalScore),
    isTextGrade: typeof course.finalScore === "string",
    creditsLabel: formatCredits(course.credits),
    termLabel: academicTermLabel(course.term),
    componentPreview: course.components.slice(0, 3).map((component) => ({
      name: component.name,
      score: formatScore(component.score),
    })),
  };
}

function buildAcademicYearOptions(
  semesters: AcademicSemesterOption[],
): YearOption[] {
  const years = [
    ...new Map(
      semesters.map((semester) => [semester.academicYear, semester]),
    ).values(),
  ];
  return [
    { value: 0, label: "全部学年" },
    ...years.map((semester) => ({
      value: semester.academicYear,
      label: semester.academicYearLabel,
    })),
  ];
}

function buildTermOptions(
  semesters: AcademicSemesterOption[],
  academicYear = 0,
): TermOption[] {
  const terms = [
    ...new Set(
      semesters
        .filter(
          (semester) => !academicYear || semester.academicYear === academicYear,
        )
        .map((semester) => semester.term),
    ),
  ].sort((left, right) => left - right);
  return [
    { value: 0, label: "全部" },
    ...terms.map((term) => ({ value: term, label: academicTermLabel(term) })),
  ];
}

function buildSemesterChips(
  semesters: AcademicSemesterOption[],
): SemesterChip[] {
  return semesters.map((semester) => ({
    id: `${semester.academicYear}-${semester.term}`,
    label: `${semester.academicYearLabel} · ${academicTermLabel(semester.term)}`,
    academicYear: semester.academicYear,
    term: semester.term,
  }));
}

function summaryDefaults(): GradeSummary {
  return {
    courseCount: 0,
    totalCredits: 0,
    numericGradedCredits: 0,
    numericWeightedAverage: null,
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
    headerScrolled: false,
    loading: true,
    refreshing: false,
    loadingMore: false,
    errorMessage: "",
    loaded: false,
    searchFocused: false,
    queryText: "",
    gradeItems: [] as GradeView[],
    summary: summaryDefaults(),
    averageLabel: "—",
    page: 1,
    totalPages: 1,
    total: 0,
    academicYear: 0,
    term: 0,
    sort: "academicYear" as NonNullable<GradesQuery["sort"]>,
    order: "desc" as NonNullable<GradesQuery["order"]>,
    filterVisible: false,
    draftAcademicYear: 0,
    draftTerm: 0,
    draftSort: "academicYear" as NonNullable<GradesQuery["sort"]>,
    draftOrder: "desc" as NonNullable<GradesQuery["order"]>,
    filterLabel: "全部成绩",
    sourceLabel: "每日自动更新",
    cached: false,
    fetchedAt: "",
    availableSemesters: [] as AcademicSemesterOption[],
    semesterChips: [] as SemesterChip[],
    activeSemesterId: "all",
    academicYearOptions: [{ value: 0, label: "全部学年" }] as YearOption[],
    termOptions: [{ value: 0, label: "全部" }] as TermOption[],
    sortOptions: [
      { value: "academicYear", label: "按学期" },
      { value: "courseName", label: "按课程名" },
      { value: "finalScore", label: "按总评" },
    ],
  },
  onLoad() {
    this.applyAppearance();
  },
  onShow() {
    if (!ensureAuthenticated()) {
      return;
    }
    this.applyAppearance();
    if (!this.data.loaded) {
      void this.loadGrades(true, false);
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
    const parts: string[] = [];
    if (this.data.academicYear) {
      parts.push(`${this.data.academicYear}-${this.data.academicYear + 1}`);
    }
    if (this.data.term) {
      parts.push(academicTermLabel(this.data.term));
    }
    return parts.length ? parts.join(" · ") : "全部成绩";
  },
  async loadGrades(reset: boolean, refresh: boolean) {
    if (
      (this.data.loading || this.data.loadingMore) &&
      this.data.loaded &&
      !refresh
    ) {
      return;
    }
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++requestSequence;
    this.setData({
      loading: reset && !this.data.gradeItems.length,
      refreshing: false,
      loadingMore: !reset,
      errorMessage: "",
    });

    try {
      const result = await getGrades({
        page,
        pageSize: PAGE_SIZE,
        academicYear: this.data.academicYear || undefined,
        term: (this.data.term || undefined) as 1 | 2 | 3 | undefined,
        q: this.data.queryText.trim() || undefined,
        sort: this.data.sort,
        order: this.data.order,
        refresh,
      });
      if (sequence !== requestSequence) {
        return;
      }
      const incoming = result.data.items.map(toGradeView);
      const fetchedAt = result.meta.fetchedAt
        ? formatDateTime(result.meta.fetchedAt)
        : "";
      this.setData({
        gradeItems: reset ? incoming : [...this.data.gradeItems, ...incoming],
        summary: result.data.summary,
        averageLabel: displayAverage(
          result.data.summary.numericWeightedAverage,
        ),
        page: result.data.pagination.page,
        totalPages: result.data.pagination.totalPages,
        total: result.data.pagination.total,
        availableSemesters: result.data.semesters,
        semesterChips: buildSemesterChips(result.data.semesters),
        activeSemesterId:
          this.data.academicYear && this.data.term
            ? `${this.data.academicYear}-${this.data.term}`
            : "all",
        academicYearOptions: buildAcademicYearOptions(result.data.semesters),
        termOptions: buildTermOptions(
          result.data.semesters,
          this.data.academicYear,
        ),
        loaded: true,
        cached: result.meta.cached,
        fetchedAt,
        sourceLabel: result.meta.cached
          ? fetchedAt
            ? `缓存更新于 ${fetchedAt}`
            : "使用今日缓存"
          : "刚刚从教务系统更新",
        filterLabel: this.buildFilterLabel(),
      });
    } catch (error) {
      if (sequence === requestSequence) {
        this.setData({
          errorMessage: getErrorMessage(error, "成绩加载失败。"),
        });
      }
    } finally {
      if (sequence === requestSequence) {
        this.setData({ loading: false, refreshing: false, loadingMore: false });
      }
    }
  },
  onRefresh() {
    haptic("medium");
    void this.loadGrades(true, true);
  },
  selectSemesterQuick(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "all");
    if (id === this.data.activeSemesterId) return;
    haptic("light");
    if (id === "all") {
      this.setData({ academicYear: 0, term: 0, activeSemesterId: "all" });
    } else {
      const chip = this.data.semesterChips.find((item) => item.id === id);
      if (!chip) return;
      this.setData({
        academicYear: chip.academicYear,
        term: chip.term,
        activeSemesterId: chip.id,
      });
    }
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
    this.setData({
      filterVisible: true,
      draftAcademicYear: this.data.academicYear,
      draftTerm: this.data.term,
      draftSort: this.data.sort,
      draftOrder: this.data.order,
      termOptions: buildTermOptions(
        this.data.availableSemesters,
        this.data.academicYear,
      ),
    });
  },
  closeFilter() {
    this.setData({ filterVisible: false });
  },
  selectDraftAcademicYear(event: WechatMiniprogram.TouchEvent) {
    haptic("light");
    const draftAcademicYear = Number(event.currentTarget.dataset.value);
    const termOptions = buildTermOptions(
      this.data.availableSemesters,
      draftAcademicYear,
    );
    const validTerms = termOptions.map((option) => option.value);
    this.setData({
      draftAcademicYear,
      draftTerm: validTerms.includes(this.data.draftTerm)
        ? this.data.draftTerm
        : 0,
      termOptions,
    });
  },
  selectDraftTerm(event: WechatMiniprogram.TouchEvent) {
    haptic("light");
    this.setData({ draftTerm: Number(event.currentTarget.dataset.value) });
  },
  selectDraftSort(event: WechatMiniprogram.TouchEvent) {
    haptic("light");
    this.setData({
      draftSort: String(event.currentTarget.dataset.value) as NonNullable<
        GradesQuery["sort"]
      >,
    });
  },
  selectDraftOrder(event: WechatMiniprogram.TouchEvent) {
    haptic("light");
    this.setData({
      draftOrder: String(event.currentTarget.dataset.value) as "asc" | "desc",
    });
  },
  resetFilter() {
    this.setData({
      draftAcademicYear: 0,
      draftTerm: 0,
      draftSort: "academicYear",
      draftOrder: "desc",
      termOptions: buildTermOptions(this.data.availableSemesters),
    });
  },
  applyFilter() {
    haptic("medium");
    this.setData({
      academicYear: this.data.draftAcademicYear,
      term: this.data.draftTerm,
      sort: this.data.draftSort,
      order: this.data.draftOrder,
      filterVisible: false,
      activeSemesterId:
        this.data.draftAcademicYear && this.data.draftTerm
          ? `${this.data.draftAcademicYear}-${this.data.draftTerm}`
          : "all",
    });
    wx.nextTick(() => {
      this.setData({ filterLabel: this.buildFilterLabel() });
      void this.loadGrades(true, false);
    });
  },
  openGrade(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    const grade = this.data.gradeItems.find((item) => item.id === id);
    if (!grade) {
      return;
    }
    haptic("light");
    getApp<IAppOption>().globalData.selectedGrade = grade;
    void navigateTo(
      `/pages/grade-detail/index?id=${encodeURIComponent(id)}`,
      "wx://cupertino-modal",
    );
  },
});
