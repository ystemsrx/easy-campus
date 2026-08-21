import type { GradeCourse } from "../../../types/api";
import { resolveAppearance } from "../../../utils/appearance";
import { academicTermLabel } from "../../../utils/date";
import { formatCredits, formatScore, scoreTone } from "../../../utils/format";
import {
  gradeComponentWidths,
  isMakeupOrDeferredGrade,
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

function scoreProgress(score: number | string | null): number {
  if (typeof score !== "number") return 0;
  return Math.max(0, Math.min(100, score));
}

function isCompactScore(value: string): boolean {
  const normalized = value.trim();
  if (/^-?\d{1,3}$/.test(normalized)) return false;
  return Array.from(normalized).length > 2;
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
  },
  onShow() {
    this.setData(resolveAppearance());
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
      scoreTone: scoreTone(course.finalScore),
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
});
