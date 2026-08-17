import { getPassRates } from "../../services/teaching";
import { getErrorMessage } from "../../services/request";
import type {
  PassRateCourse,
  PassRateDistributionItem,
  PassRatesData,
  PassRateScoreItem,
  PassRateStatistics,
} from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import { academicTermLabel } from "../../utils/date";
import { formatCredits, formatScore } from "../../utils/format";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated } from "../../utils/navigation";

interface CourseView extends PassRateCourse {
  displayScore: string;
  textScore: boolean;
  hasComparableScore: boolean;
  creditsLabel: string;
  gradePointLabel: string;
  termLabel: string;
  semesterId: string;
  semesterLabel: string;
  semesterOrder: number;
}

interface CourseGroup {
  id: string;
  label: string;
  order: number;
  expanded: boolean;
  courses: CourseView[];
}

interface ComponentView {
  name: string;
  score: string;
  weightLabel: string;
  width: number;
  opacity: number;
}

interface DistributionView extends PassRateDistributionItem {
  height: number;
  mine: boolean;
}

interface ScoreView extends PassRateScoreItem {
  height: number;
  mine: boolean;
}

let requestSequence = 0;

function scoreLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  if (value < 60) return "<60";
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(2)));
}

function scoreBand(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  if (value < 60) return "<60";
  if (value < 70) return "60–69";
  if (value < 80) return "70–79";
  if (value < 90) return "80–89";
  return "90–100";
}

function toCourseView(course: PassRateCourse): CourseView {
  const creditsLabel = formatCredits(course.credits);
  const termLabel = academicTermLabel(course.term);
  const academicYear = String(course.academicYear || "").trim();
  const academicYearStart = Number(
    academicYear.match(/(?:19|20)\d{2}/)?.[0] || 0,
  );
  const term = Number(course.term || 0);
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
    semesterLabel: academicYear ? `${academicYear} · ${termLabel}` : termLabel,
    semesterOrder: academicYearStart * 10 + term,
  };
}

function courseGroups(
  courses: CourseView[],
  expandedSemesterId = "",
): CourseGroup[] {
  const grouped = new Map<string, CourseGroup>();
  for (const course of courses) {
    const existing = grouped.get(course.semesterId);
    if (existing) {
      existing.courses.push(course);
      continue;
    }
    grouped.set(course.semesterId, {
      id: course.semesterId,
      label: course.semesterLabel,
      order: course.semesterOrder,
      expanded: false,
      courses: [course],
    });
  }
  const result = [...grouped.values()].sort(
    (left, right) => right.order - left.order,
  );
  const activeId = result.some((group) => group.id === expandedSemesterId)
    ? expandedSemesterId
    : result[0]?.id || "";
  return result.map((group) => ({
    ...group,
    expanded: group.id === activeId,
  }));
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

function distributionViews(
  statistics: PassRateStatistics,
  ownScore: number | null,
): DistributionView[] {
  const maximum = Math.max(
    0,
    ...statistics.distribution.map((item) => item.count),
  );
  const mine = scoreBand(ownScore);
  return statistics.distribution.map((item) => ({
    ...item,
    height: maximum ? Math.max(4, (item.count / maximum) * 100) : 0,
    mine: item.band === mine,
  }));
}

function scoreViews(
  statistics: PassRateStatistics,
  ownScore: number | null,
): ScoreView[] {
  const maximum = Math.max(0, ...statistics.scores.map((item) => item.count));
  const mine = scoreLabel(ownScore);
  return statistics.scores.map((item) => ({
    ...item,
    height: maximum ? Math.max(4, (item.count / maximum) * 100) : 0,
    mine: item.score === mine,
  }));
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    headerScrolled: false,
    loading: true,
    updating: false,
    loaded: false,
    errorMessage: "",
    pickerVisible: false,
    courses: [] as CourseView[],
    courseGroups: [] as CourseGroup[],
    course: null as CourseView | null,
    components: [] as ComponentView[],
    statistics: null as PassRateStatistics | null,
    status: "collecting" as "ready" | "collecting",
    message: "统计中，请稍后查看",
    averageScoreLabel: "—",
    cohortLabel: "",
    distribution: [] as DistributionView[],
    scoreEntries: [] as ScoreView[],
    scoreChartWidth: 620,
  },
  onLoad() {
    this.setData(resolveAppearance());
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.setData(resolveAppearance(), () => {
      if (this.data.statistics) {
        this.drawPassRing(this.data.statistics.passRate);
      }
    });
    if (!this.data.loaded) void this.loadPassRates();
  },
  onUnload() {
    requestSequence += 1;
  },
  onScroll(event: WechatMiniprogram.ScrollViewScroll) {
    const headerScrolled = event.detail.scrollTop > 18;
    if (headerScrolled !== this.data.headerScrolled) {
      this.setData({ headerScrolled });
    }
  },
  async loadPassRates(courseKey = "") {
    const sequence = ++requestSequence;
    const hasCourse = Boolean(this.data.course);
    this.setData({
      loading: !hasCourse,
      updating: hasCourse,
      errorMessage: "",
    });
    try {
      const result = await getPassRates(courseKey || undefined);
      if (sequence !== requestSequence) return;
      this.applyData(result.data);
    } catch (error) {
      if (sequence !== requestSequence) return;
      const message = getErrorMessage(error, "通过率加载失败，请稍后重试。");
      if (hasCourse) {
        wx.showToast({ title: message, icon: "none" });
      } else {
        this.setData({ errorMessage: message });
      }
    } finally {
      if (sequence === requestSequence) {
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
    const ownScore = course?.calculationScore ?? null;
    this.setData(
      {
        courses,
        courseGroups: courseGroups(courses),
        course,
        components: course ? componentViews(course) : [],
        statistics,
        status: data.status,
        message: data.message || "统计中，请稍后查看",
        averageScoreLabel: statistics
          ? Number.isInteger(statistics.averageScore)
            ? String(statistics.averageScore)
            : statistics.averageScore.toFixed(1)
          : "—",
        cohortLabel: statistics
          ? statistics.cohorts
              .map((year) => `${String(year).slice(-2)}级`)
              .join("、")
          : "",
        distribution: statistics ? distributionViews(statistics, ownScore) : [],
        scoreEntries: statistics ? scoreViews(statistics, ownScore) : [],
        scoreChartWidth: statistics
          ? Math.max(620, statistics.scores.length * 38)
          : 620,
        loaded: true,
        errorMessage: "",
      },
      () => {
        if (statistics) this.drawPassRing(statistics.passRate);
      },
    );
  },
  drawPassRing(passRate: number) {
    const query = wx.createSelectorQuery();
    query.select("#pass-rate-ring-canvas").fields({ node: true, size: true });
    query.exec((results) => {
      const result = results[0] as {
        node?: WechatMiniprogram.Canvas;
        width?: number;
        height?: number;
      };
      const canvas = result?.node;
      const width = Number(result?.width || 0);
      const height = Number(result?.height || 0);
      if (!canvas || !width || !height) return;
      const pixelRatio = wx.getWindowInfo().pixelRatio || 1;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      const context = canvas.getContext("2d");
      context.scale(pixelRatio, pixelRatio);
      context.clearRect(0, 0, width, height);
      const lineWidth = (width * 17) / 184;
      const radius = Math.max(0, Math.min(width, height) / 2 - lineWidth / 2);
      const centerX = width / 2;
      const centerY = height / 2;
      context.lineWidth = lineWidth;
      context.lineCap = "round";
      context.beginPath();
      context.strokeStyle =
        this.data.theme === "dark"
          ? "rgba(255, 255, 255, 0.08)"
          : "rgba(43, 38, 32, 0.06)";
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.strokeStyle = "#7d8f6e";
      context.arc(
        centerX,
        centerY,
        radius,
        -Math.PI / 2,
        -Math.PI / 2 +
          Math.PI * 2 * (Math.max(0, Math.min(100, passRate)) / 100),
      );
      context.stroke();
    });
  },
  retry() {
    void this.loadPassRates(this.data.course?.statisticsKey || "");
  },
  openPicker() {
    if (this.data.courses.length < 2) return;
    haptic("light");
    this.setData({
      pickerVisible: true,
      courseGroups: courseGroups(this.data.courses),
    });
  },
  closePicker() {
    this.setData({ pickerVisible: false });
  },
  toggleSemester(event: WechatMiniprogram.TouchEvent) {
    const semesterId = String(event.currentTarget.dataset.semester || "");
    if (!semesterId) return;
    haptic("light");
    this.setData({
      courseGroups: this.data.courseGroups.map((group) => ({
        ...group,
        expanded: group.id === semesterId ? !group.expanded : false,
      })),
    });
  },
  selectCourse(event: WechatMiniprogram.TouchEvent) {
    const courseKey = String(event.currentTarget.dataset.key || "");
    if (!courseKey) return;
    haptic("light");
    this.setData({ pickerVisible: false });
    if (courseKey !== this.data.course?.statisticsKey) {
      void this.loadPassRates(courseKey);
    }
  },
});
