import type { AcademicSemesterOption } from "../types/api";

export function semesterSeasonLabel(term: number): string {
  if (term === 1) return "秋";
  if (term === 2) return "春";
  if (term === 3) return "夏";
  return "";
}

export function shortAcademicSemesterLabel(
  semester: AcademicSemesterOption | null,
  separator = " ",
): string {
  if (!semester) return "选择学期";
  const start = String(semester.academicYear % 100).padStart(2, "0");
  const end = String((semester.academicYear + 1) % 100).padStart(2, "0");
  const season = semesterSeasonLabel(semester.term);
  return season ? `${start}-${end}${separator}${season}` : `${start}-${end}`;
}

export function timetableSemesterMenuLabel(
  semester: AcademicSemesterOption,
): string {
  return semester.term === 3
    ? `${semester.academicYearLabel} · 夏`
    : semester.label;
}
