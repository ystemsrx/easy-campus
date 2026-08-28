import type { AcademicSemesterOption, TimetableData } from "../types/api";

export interface StartedSemesterBoundary {
  semesterId: string;
  startDate: string;
}

type TimetableSemesterContext = Pick<
  TimetableData,
  "semester" | "currentSemester" | "semesterCalendar"
>;

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKey(value: string): string {
  return /^(\d{4}-\d{2}-\d{2})/.exec(String(value || "").trim())?.[1] || "";
}

export function startedCurrentSemester(
  timetable: TimetableSemesterContext | null | undefined,
  referenceDate = localDateKey(),
): StartedSemesterBoundary | null {
  if (!timetable) return null;
  const current = timetable.currentSemester;
  const calendar = timetable.semesterCalendar;
  if (current) {
    const startDate = dateKey(current.startDate);
    return startDate && referenceDate >= startDate
      ? { semesterId: current.id, startDate }
      : null;
  }
  const startDate = dateKey(calendar?.startDate || "");
  return calendar?.semesterId === timetable.semester.id &&
    startDate &&
    referenceDate >= startDate
    ? { semesterId: timetable.semester.id, startDate }
    : null;
}

export function isCurrentSemesterTimestamp(
  value: string,
  boundary: StartedSemesterBoundary | null,
): boolean {
  if (!boundary) return true;
  const valueDate = dateKey(value);
  return !valueDate || valueDate >= boundary.startDate;
}

export function isCurrentSemesterId(
  semesterId: string | null | undefined,
  boundary: StartedSemesterBoundary | null,
): boolean {
  return !boundary || semesterId === boundary.semesterId;
}

export function latestSchoolNoticeSemesterId(
  items: ReadonlyArray<{ semesterId?: string | null }>,
): string | null {
  let latestSemesterId: string | null = null;
  let latestRank: number | null = null;
  for (const item of items) {
    const rank = semesterRank(item.semesterId);
    if (rank !== null && (latestRank === null || rank > latestRank)) {
      latestSemesterId = String(item.semesterId);
      latestRank = rank;
    }
  }
  return latestSemesterId;
}

export function isLatestSchoolNoticeSemesterAssignment(
  semesterId: string | null | undefined,
  latestSemesterId: string | null | undefined,
  fallbackTimestamp: string,
  boundary: StartedSemesterBoundary | null,
): boolean {
  const assignedRank = semesterRank(semesterId);
  const latestRank = semesterRank(latestSemesterId);
  if (assignedRank !== null && latestRank !== null) {
    return assignedRank === latestRank;
  }
  return isCurrentSemesterTimestamp(fallbackTimestamp, boundary);
}

function semesterRank(value: string | null | undefined): number | null {
  const matched = /^(\d{4})-([123])$/.exec(String(value || ""));
  if (!matched) return null;
  return Number(matched[1]) * 3 + Number(matched[2]) - 1;
}

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

export function numberedAcademicSemesterLabel(
  semester: AcademicSemesterOption,
): string {
  return `${semester.academicYearLabel} · ${semester.term}`;
}

export function timetableSemesterMenuLabel(
  semester: AcademicSemesterOption,
): string {
  return semester.term === 3
    ? `${semester.academicYearLabel} · 夏`
    : semester.label;
}
