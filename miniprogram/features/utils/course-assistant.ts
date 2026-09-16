import type { CourseAssistantCourseType } from "../../types/api";

function uniqueTeacherNames(names?: string[] | null): string[] {
  return [...new Set((names || []).map((name) => name.trim()).filter(Boolean))];
}

export function formatCourseTeacherNames(
  names: string[] | null | undefined,
  courseType: CourseAssistantCourseType,
): string {
  const teachers = uniqueTeacherNames(names);
  if (!teachers.length) return "暂无信息";
  const visibleLimit = courseType === "general_elective" ? 2 : 3;
  return teachers.length <= visibleLimit ? teachers.join("、") : "多名教师";
}

export function formatReviewTeacherNames(names?: string[] | null): string {
  return uniqueTeacherNames(names).join("、") || "暂无教师信息";
}
