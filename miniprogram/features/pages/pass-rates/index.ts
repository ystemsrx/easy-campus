import { getPassRates } from "../../../services/teaching";
import { getErrorMessage } from "../../../services/request";
import type {
  PassRateCourse,
  PassRatesData,
  PassRateStatistics,
} from "../../../types/api";
import { resolveAppearance } from "../../../utils/appearance";
import { academicTermLabel } from "../../../utils/date";
import { formatCredits, formatScore } from "../../../utils/format";
import { haptic } from "../../../utils/haptics";
import { ensureAuthenticated } from "../../../utils/navigation";
import { shortAcademicSemesterLabel } from "../../../utils/semester";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
  sessionLeaseKey,
} from "../../../store/session";

interface CourseView extends PassRateCourse {
  displayScore: string;
  textScore: boolean;
  hasComparableScore: boolean;
  creditsLabel: string;
  gradePointLabel: string;
  termLabel: string;
  semesterId: string;
  semesterShortLabel: string;
  semesterOrder: number;
}

interface CourseGroup {
  id: string;
  label: string;
  order: number;
  courses: CourseView[];
}

interface CoursePickerRow {
  id: string;
  items: CourseView[];
}

interface ComponentView {
  name: string;
  score: string;
  weightLabel: string;
  width: number;
  opacity: number;
}

let requestSequence = 0;
let activePassRateSessionKey = "";
let pickerTransitionTimer: number | undefined;

function clearPickerTransitionTimer() {
  if (pickerTransitionTimer !== undefined) {
    clearTimeout(pickerTransitionTimer);
    pickerTransitionTimer = undefined;
  }
}

function toCourseView(course: PassRateCourse): CourseView {
  const creditsLabel = formatCredits(course.credits);
  const termLabel = academicTermLabel(course.term);
  const academicYear = String(course.academicYear || "").trim();
  const academicYearStart = Number(
    academicYear.match(/(?:19|20)\d{2}/)?.[0] || 0,
  );
  const term = Number(course.term || 0);
  const semesterShortLabel =
    academicYearStart && course.term
      ? shortAcademicSemesterLabel(
          {
            id: `${academicYearStart}-${course.term}`,
            academicYear: academicYearStart,
            academicYearLabel: academicYear,
            term: course.term,
            label: "",
          },
          " · ",
        )
      : termLabel;
  return {
    ...course,
    displayScore: formatScore(course.finalScore),
    textScore: typeof course.finalScore === "string",
    hasComparableScore:
      course.hasOwnGrade && typeof course.calculationScore === "number",
    creditsLabel,
    gradePointLabel:
      typeof course.gradePoint === "number"
        ? course.gradePoint.toFixed(1)
        : "—",
    termLabel,
    semesterId: academicYearStart
      ? `${academicYearStart}-${term}`
      : `unknown-${term}`,
    semesterShortLabel,
    semesterOrder: academicYearStart * 10 + term,
  };
}

function courseGroups(courses: CourseView[]): CourseGroup[] {
  const grouped = new Map<string, CourseGroup>();
  for (const course of courses) {
    const existing = grouped.get(course.semesterId);
    if (existing) {
      existing.courses.push(course);
      continue;
    }
    grouped.set(course.semesterId, {
      id: course.semesterId,
      label: course.semesterShortLabel,
      order: course.semesterOrder,
      courses: [course],
    });
  }
  return [...grouped.values()].sort((left, right) => right.order - left.order);
}

function toCourseRows(courses: CourseView[]): CoursePickerRow[] {
  return courses.map((course) => ({
    id: course.statisticsKey,
    items: [course],
  }));
}

function coursePickerState(groups: CourseGroup[], semesterId = "") {
  const activeGroup =
    groups.find((group) => group.id === semesterId) || groups[0] || null;
  return {
    selectedSemesterId: activeGroup?.id || "",
    courseRows: toCourseRows(activeGroup?.courses || []),
  };
}

function componentViews(course: PassRateCourse): ComponentView[] {
  const count = course.components.length;
  const declared = course.components.map((component) =>
    typeof component.weightPercent === "number" && component.weightPercent > 0
      ? component.weightPercent
      : null,
  );
  const declaredTotal = declared.reduce<number>(
    (total, weight) => total + (weight || 0),
    0,
  );
  const missingCount = declared.filter((weight) => weight === null).length;
  const missingWeight = missingCount
    ? Math.max(0, 100 - declaredTotal) / missingCount || 1
    : 0;
  const rawWeights = declared.map((weight) => weight ?? missingWeight);
  const totalWeight =
    rawWeights.reduce((total, weight) => total + weight, 0) || count || 1;
  return course.components.map((component, index) => ({
    name: component.name,
    score: formatScore(component.score),
    weightLabel:
      component.weightPercent === null
        ? "占比未提供"
        : `${Number.isInteger(component.weightPercent) ? component.weightPercent : Number(component.weightPercent.toFixed(2))}%`,
    width: Number(((rawWeights[index] / totalWeight) * 100).toFixed(2)),
    opacity: Math.max(0.35, 1 - index * 0.2),
  }));
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    loading: true,
    updating: false,
    loaded: false,
    errorMessage: "",
    pickerVisible: false,
    pickerMounted: false,
    pickerActive: false,
    courses: [] as CourseView[],
    courseGroups: [] as CourseGroup[],
    selectedSemesterId: "",
    courseRows: [] as CoursePickerRow[],
    course: null as CourseView | null,
    components: [] as ComponentView[],
    statistics: null as PassRateStatistics | null,
    status: "collecting" as "ready" | "collecting",
    message: "统计中，请稍后查看",
    averageScoreLabel: "—",
    averageScoreTitle: "年级平均",
    percentageOnly: false,
    cohortLabel: "",
    ownScore: -1,
  },
  onLoad() {
    activePassRateSessionKey = "";
    this.setData(resolveAppearance());
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    const lease = captureSessionLease();
    if (!lease) return;
    const currentSessionKey = sessionLeaseKey(lease);
    if (
      activePassRateSessionKey &&
      activePassRateSessionKey !== currentSessionKey
    ) {
      requestSequence += 1;
      clearPickerTransitionTimer();
      this.setData({
        loading: true,
        updating: false,
        loaded: false,
        errorMessage: "",
        pickerVisible: false,
        pickerMounted: false,
        pickerActive: false,
        courses: [],
        courseGroups: [],
        selectedSemesterId: "",
        courseRows: [],
        course: null,
        components: [],
        statistics: null,
        status: "collecting",
        message: "统计中，请稍后查看",
        averageScoreLabel: "—",
        averageScoreTitle: "年级平均",
        percentageOnly: false,
        cohortLabel: "",
        ownScore: -1,
      });
    }
    activePassRateSessionKey = currentSessionKey;
    this.setData(resolveAppearance());
    if (!this.data.loaded) void this.loadPassRates();
  },
  onUnload() {
    requestSequence += 1;
    clearPickerTransitionTimer();
  },
  async loadPassRates(courseKey = "") {
    const lease = captureSessionLease();
    if (!lease) return;
    const sequence = ++requestSequence;
    const hasCourse = Boolean(this.data.course);
    this.setData({
      loading: !hasCourse,
      updating: hasCourse,
      errorMessage: "",
    });
    try {
      const result = await getPassRates(courseKey || undefined);
      if (sequence !== requestSequence || !isSessionLeaseCurrent(lease)) return;
      this.applyData(result.data);
    } catch (error) {
      if (sequence !== requestSequence || !isSessionLeaseCurrent(lease)) return;
      const message = getErrorMessage(error, "通过率加载失败，请稍后重试。");
      if (message && hasCourse) {
        wx.showToast({ title: message, icon: "none" });
      } else if (message) {
        this.setData({ errorMessage: message });
      }
    } finally {
      if (sequence === requestSequence && isSessionLeaseCurrent(lease)) {
        this.setData({ loading: false, updating: false, loaded: true });
      }
    }
  },
  applyData(data: PassRatesData) {
    const courses = data.courses.map(toCourseView);
    const course = data.selectedCourse
      ? toCourseView(data.selectedCourse)
      : null;
    const statistics = data.statistics;
    const groups = courseGroups(courses);
    const pickerState = coursePickerState(groups, this.data.selectedSemesterId);
    this.setData({
      courses,
      courseGroups: groups,
      ...pickerState,
      course,
      components: course ? componentViews(course) : [],
      statistics,
      status: data.status,
      message: data.message || "统计中，请稍后查看",
      averageScoreLabel: statistics
        ? `${
            Number.isInteger(statistics.averageScore)
              ? String(statistics.averageScore)
              : statistics.averageScore.toFixed(1)
          }${data.percentageOnly ? "%" : ""}`
        : "—",
      averageScoreTitle: data.percentageOnly ? "全校平均" : "年级平均",
      percentageOnly: data.percentageOnly,
      cohortLabel: statistics
        ? `${statistics.cohorts
            .map((year) => String(year).slice(-2))
            .join("、")}${statistics.cohorts.length ? "级" : ""}`
        : "",
      ownScore:
        typeof course?.calculationScore === "number"
          ? course.calculationScore
          : -1,
      loaded: true,
      errorMessage: "",
    });
  },
  retry() {
    void this.loadPassRates(this.data.course?.statisticsKey || "");
  },
  openPicker() {
    if (this.data.courses.length < 2) return;
    haptic("light");
    clearPickerTransitionTimer();
    const groups = courseGroups(this.data.courses);
    this.setData(
      {
        pickerVisible: true,
        pickerMounted: true,
        pickerActive: false,
        courseGroups: groups,
        ...coursePickerState(groups, this.data.selectedSemesterId),
      },
      () => {
        wx.nextTick(() => {
          if (this.data.pickerVisible) this.setData({ pickerActive: true });
        });
      },
    );
  },
  closePicker() {
    clearPickerTransitionTimer();
    this.setData({ pickerVisible: false, pickerActive: false });
    pickerTransitionTimer = setTimeout(() => {
      if (!this.data.pickerVisible) this.setData({ pickerMounted: false });
      pickerTransitionTimer = undefined;
    }, 380);
  },
  selectSemester(event: WechatMiniprogram.TouchEvent) {
    const semesterId = String(event.currentTarget.dataset.semester || "");
    if (!semesterId || semesterId === this.data.selectedSemesterId) return;
    const group = this.data.courseGroups.find((item) => item.id === semesterId);
    if (!group) return;
    haptic("light");
    this.setData({
      selectedSemesterId: semesterId,
      courseRows: toCourseRows(group.courses),
    });
  },
  selectCourse(event: WechatMiniprogram.TouchEvent) {
    const courseKey = String(event.currentTarget.dataset.key || "");
    if (!courseKey) return;
    haptic("light");
    this.closePicker();
    if (courseKey !== this.data.course?.statisticsKey) {
      void this.loadPassRates(courseKey);
    }
  },
  noop() {},
});
