import type { GradeCourse } from "../../types/api";
import { resolveAppearance } from "../../utils/appearance";
import { academicTermLabel } from "../../utils/date";
import { formatCredits, formatScore, scoreTone } from "../../utils/format";
import { gradeComponentWidths } from "../../utils/grades";

interface ComponentView {
  name: string;
  score: string;
  weight: string;
  width: number;
  progress: number;
  tone: string;
  isText: boolean;
}

interface DetailRow {
  label: string;
  value: string;
}

function scoreProgress(score: number | string | null): number {
  if (typeof score !== "number") return 0;
  return Math.max(0, Math.min(100, score));
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    course: null as GradeCourse | null,
    displayScore: "—",
    scoreTone: "muted",
    scoreIsText: false,
    creditsLabel: "—",
    gradePointLabel: "—",
    termLabel: "学期未知",
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
    const widths = gradeComponentWidths(course.components);
    const components = course.components.map((component, index) => ({
      name: component.name,
      score: formatScore(component.score),
      weight:
        component.weightPercent === null
          ? "权重未提供"
          : `占比 ${component.weightPercent}%`,
      width: widths[index],
      progress: scoreProgress(component.score),
      tone: scoreTone(component.score),
      isText: typeof component.score === "string",
    }));
    const rows = [
      { label: "课程代码", value: course.courseCode || "—" },
      { label: "教学班", value: course.teachingClass || "—" },
      { label: "开课学院", value: course.department || "—" },
      { label: "课程性质", value: course.courseNature || "—" },
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
      displayScore: formatScore(course.finalScore),
      scoreTone: scoreTone(course.finalScore),
      scoreIsText: typeof course.finalScore === "string",
      creditsLabel: formatCredits(course.credits),
      gradePointLabel:
        typeof course.gradePoint === "number"
          ? course.gradePoint.toFixed(1)
          : "—",
      termLabel: academicTermLabel(course.term),
      components,
      detailRows: rows,
    });
  },
});
