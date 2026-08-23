import { getGradeClassDistribution } from "../../../services/teaching";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
} from "../../../store/session";
import type {
  GradeClassDistributionItem,
  GradeCourse,
} from "../../../types/api";
import { resolveAppearance } from "../../../utils/appearance";
import { academicTermLabel } from "../../../utils/date";
import { formatCredits, formatScore, scoreTone } from "../../../utils/format";
import {
  gradeComponentWidths,
  isMakeupOrDeferredGrade,
  isUnsuccessfulGrade,
} from "../../../utils/grades";

interface ComponentView {
  name: string;
  score: string;
  weight: string;
  width: number;
  progress: number;
  tone: string;
  isText: boolean;
  compactScore: boolean;
}

interface DetailRow {
  label: string;
  value: string;
}

interface ClassDistributionBar extends GradeClassDistributionItem {
  height: number;
  scoreLabel: string;
  showScoreLabel: boolean;
}

interface ClassDistributionAxisTick {
  value: number;
  label: string;
}

interface ClassDistributionChart {
  bars: ClassDistributionBar[];
  ticks: ClassDistributionAxisTick[];
  barWidth: number;
  chartWidth: number;
}

const CLASS_DISTRIBUTION_MIN_SAMPLES = 10;
const CLASS_CHART_VIEWPORT_WIDTH = 520;
const CLASS_BAR_GAP = 8;
const CLASS_BAR_MIN_WIDTH = 24;
const CLASS_BAR_MAX_WIDTH = 68;
const CLASS_AXIS_TARGET_SEGMENTS = 4;
const CLASS_X_AXIS_MAX_LABELS = 8;
let classDistributionRequestSequence = 0;

function scoreProgress(score: number | string | null): number {
  if (typeof score !== "number") return 0;
  return Math.max(0, Math.min(100, score));
}

function isCompactScore(value: string): boolean {
  const normalized = value.trim();
  if (/^-?\d{1,3}$/.test(normalized)) return false;
  return Array.from(normalized).length > 2;
}

function gradeAcademicYearStart(course: GradeCourse): number | null {
  const year = Number(
    String(course.academicYear || "").match(/(?:19|20)\d{2}/)?.[0],
  );
  return Number.isInteger(year) && year >= 1900 && year <= 2099 ? year : null;
}

function classScoreLabel(value: number): string {
  return String(Number(value.toFixed(2)));
}

function niceCountStep(value: number): number {
  if (!Number.isFinite(value) || value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const multiplier = [1, 2, 3, 5, 10].find(
    (candidate) => normalized <= candidate,
  );
  return Math.max(1, Math.ceil((multiplier || 10) * magnitude));
}

function classDistributionChart(
  source: GradeClassDistributionItem[],
): ClassDistributionChart | null {
  const grouped = new Map<number, number>();
  for (const item of source) {
    const score = Number(item.score);
    const count = Number(item.count);
    if (
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100 ||
      !Number.isInteger(count) ||
      count < 1
    ) {
      continue;
    }
    const normalizedScore = Number(score.toFixed(2));
    grouped.set(normalizedScore, (grouped.get(normalizedScore) || 0) + count);
  }
  const distribution = [...grouped.entries()]
    .map(([score, count]) => ({ score, count }))
    .sort((left, right) => left.score - right.score);
  const sampleCount = distribution.reduce(
    (total, item) => total + item.count,
    0,
  );
  if (sampleCount < CLASS_DISTRIBUTION_MIN_SAMPLES) return null;

  const maximumCount = Math.max(...distribution.map((item) => item.count));
  const axisStep = niceCountStep(
    maximumCount / CLASS_AXIS_TARGET_SEGMENTS,
  );
  const axisMaximum = Math.max(
    axisStep,
    Math.ceil(maximumCount / axisStep) * axisStep,
  );
  const axisSegments = Math.ceil(axisMaximum / axisStep);
  const scoreCount = distribution.length;
  const labelInterval = Math.max(
    1,
    Math.ceil(scoreCount / CLASS_X_AXIS_MAX_LABELS),
  );
  const desiredBarWidth =
    (CLASS_CHART_VIEWPORT_WIDTH - CLASS_BAR_GAP * (scoreCount - 1)) /
    scoreCount;
  const barWidth = Math.max(
    CLASS_BAR_MIN_WIDTH,
    Math.min(CLASS_BAR_MAX_WIDTH, desiredBarWidth),
  );
  const occupiedWidth =
    scoreCount * barWidth + Math.max(0, scoreCount - 1) * CLASS_BAR_GAP;

  return {
    bars: distribution.map((item, index) => ({
      ...item,
      height: Math.max(3, (item.count / axisMaximum) * 100),
      scoreLabel: classScoreLabel(item.score),
      showScoreLabel:
        index === 0 ||
        index === scoreCount - 1 ||
        index % labelInterval === 0,
    })),
    ticks: Array.from({ length: axisSegments + 1 }, (_item, index) => {
      const value = axisMaximum - axisStep * index;
      return { value, label: String(value) };
    }),
    barWidth: Number(barWidth.toFixed(2)),
    chartWidth: Math.max(
      CLASS_CHART_VIEWPORT_WIDTH,
      Math.ceil(occupiedWidth),
    ),
  };
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    detailTitle: "课程成绩与组成",
    course: null as GradeCourse | null,
    displayScore: "—",
    scoreTone: "muted",
    scoreIsText: false,
    creditsLabel: "—",
    gradePointLabel: "—",
    termLabel: "学期未知",
    showComponentsSection: true,
    components: [] as ComponentView[],
    detailRows: [] as DetailRow[],
    classDistributionStatus: "loading" as
      | "loading"
      | "ready"
      | "insufficient"
      | "error",
    classDistributionBars: [] as ClassDistributionBar[],
    classDistributionAxisTicks: [] as ClassDistributionAxisTick[],
    classDistributionBarWidth: CLASS_BAR_MAX_WIDTH,
    classDistributionChartWidth: CLASS_CHART_VIEWPORT_WIDTH,
  },
  onLoad() {
    this.setData(resolveAppearance());
    const course = getApp<IAppOption>().globalData.selectedGrade;
    if (!course) {
      wx.showToast({ title: "成绩信息已过期，请重新打开", icon: "none" });
      setTimeout(() => wx.navigateBack(), 900);
      return;
    }
    this.applyCourse(course);
    if (!isMakeupOrDeferredGrade(course)) {
      void this.loadClassDistribution(course);
    }
  },
  onShow() {
    this.setData(resolveAppearance());
  },
  onUnload() {
    classDistributionRequestSequence += 1;
  },
  applyCourse(course: GradeCourse) {
    const showComponentsSection = !isMakeupOrDeferredGrade(course);
    const sourceComponents = showComponentsSection ? course.components : [];
    const widths = gradeComponentWidths(sourceComponents);
    const components = sourceComponents.map((component, index) => {
      const displayScore = formatScore(component.score);
      return {
        name: component.name,
        score: displayScore,
        weight:
          component.weightPercent === null
            ? "权重未提供"
            : `占比 ${component.weightPercent}%`,
        width: widths[index],
        progress: scoreProgress(component.score),
        tone: scoreTone(component.score),
        isText: typeof component.score === "string",
        compactScore: isCompactScore(displayScore),
      };
    });
    const rows = [
      { label: "课程代码", value: course.courseCode || "—" },
      { label: "教学班", value: course.teachingClass || "—" },
      { label: "教师", value: course.teacherName || "—" },
      { label: "开课学院", value: course.department || "—" },
      { label: "课程性质", value: course.courseNature || "—" },
      { label: "成绩性质", value: course.gradeNature || "—" },
      { label: "学年", value: course.academicYear || "—" },
      { label: "学期", value: academicTermLabel(course.term) },
      {
        label: "学分",
        value:
          course.credits === null
            ? "—"
            : `${formatCredits(course.credits)} 学分`,
      },
    ];
    this.setData({
      course,
      detailTitle: showComponentsSection ? "课程成绩与组成" : "课程成绩",
      displayScore: formatScore(course.finalScore),
      scoreTone: scoreTone(course.finalScore, isUnsuccessfulGrade(course)),
      scoreIsText: typeof course.finalScore === "string",
      creditsLabel: formatCredits(course.credits),
      gradePointLabel:
        typeof course.gradePoint === "number"
          ? course.gradePoint.toFixed(1)
          : "—",
      termLabel: academicTermLabel(course.term),
      showComponentsSection,
      components,
      detailRows: rows,
    });
  },
  async loadClassDistribution(course: GradeCourse) {
    const academicYear = gradeAcademicYearStart(course);
    const term = Number(course.term);
    const lease = captureSessionLease();
    if (
      !course.id ||
      !academicYear ||
      ![1, 2, 3].includes(term) ||
      !lease
    ) {
      this.setData({
        classDistributionStatus: lease ? "insufficient" : "error",
        classDistributionBars: [],
        classDistributionAxisTicks: [],
      });
      return;
    }
    const sequence = ++classDistributionRequestSequence;
    this.setData({
      classDistributionStatus: "loading",
      classDistributionBars: [],
      classDistributionAxisTicks: [],
    });
    try {
      const result = await getGradeClassDistribution(
        course.id,
        academicYear,
        term as 1 | 2 | 3,
      );
      if (
        sequence !== classDistributionRequestSequence ||
        !isSessionLeaseCurrent(lease)
      ) {
        return;
      }
      const chart =
        result.data.status === "ready"
          ? classDistributionChart(result.data.distribution)
          : null;
      if (!chart) {
        this.setData({
          classDistributionStatus: "insufficient",
          classDistributionBars: [],
          classDistributionAxisTicks: [],
        });
        return;
      }
      this.setData({
        classDistributionStatus: "ready",
        classDistributionBars: chart.bars,
        classDistributionAxisTicks: chart.ticks,
        classDistributionBarWidth: chart.barWidth,
        classDistributionChartWidth: chart.chartWidth,
      });
    } catch {
      if (
        sequence !== classDistributionRequestSequence ||
        !isSessionLeaseCurrent(lease)
      ) {
        return;
      }
      this.setData({
        classDistributionStatus: "error",
        classDistributionBars: [],
        classDistributionAxisTicks: [],
      });
    }
  },
  retryClassDistribution() {
    const course = this.data.course;
    if (course) void this.loadClassDistribution(course);
  },
});
