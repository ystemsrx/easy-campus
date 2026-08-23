function uniqueTeacherNames(names?: string[] | null): string[] {
  return [...new Set((names || []).map((name) => name.trim()).filter(Boolean))];
}

export function formatCourseTeacherNames(names?: string[] | null): string {
  const teachers = uniqueTeacherNames(names);
  if (!teachers.length) return "暂无教师信息";
  return teachers.length <= 3 ? teachers.join("、") : "多名教师";
}

export function formatReviewTeacherNames(names?: string[] | null): string {
  return uniqueTeacherNames(names).join("、") || "暂无教师信息";
}
