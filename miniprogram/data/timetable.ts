import type {
  TimetableArrangement,
  TimetableCourseData,
  TimetableData,
} from "../types/api";

export type TimetableTone = "blue" | "cyan" | "purple" | "green" | "orange";

export interface TimetableCourse {
  id: string;
  courseId: string;
  arrangementId: string;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  sourceWeekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  date: string | null;
  startAt: string | null;
  endAt: string | null;
  localized: boolean;
  startTime: string;
  endTime: string;
  displayTimeLabel: string;
  periodStart: number;
  periodEnd: number;
  periodLabel: string;
  weekText: string;
  weeks: number[];
  name: string;
  teacher: string;
  teacherNames: string[];
  location: string;
  campus: string | null;
  tone: TimetableTone;
  credits: number | null;
  teachingClass: string | null;
  activityTypeLabel: string;
  selectionStatus: "selected" | "pending";
  retake: boolean | null;
  adjusted: boolean;
  category: string | null;
  nature: string | null;
  assessmentMethod: string | null;
}

export interface CoursePreviewSelection {
  courses: TimetableCourse[];
  currentCourseId: string | null;
}

const SOURCE_OFFSET = "+08:00";
const ONE_DAY = 24 * 60 * 60 * 1000;
const TONES: TimetableTone[] = ["blue", "cyan", "purple", "green", "orange"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function localClock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isoWeekday(date: Date): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return (date.getDay() || 7) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) >>> 0;
  }
  return result;
}

function campusDateAt(startDate: string, days: number): string {
  const start = Date.parse(`${startDate}T00:00:00${SOURCE_OFFSET}`);
  if (!Number.isFinite(start)) return "";
  const shifted = new Date(start + days * ONE_DAY + 8 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function campusToday(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function datesAvailable(data: TimetableData): boolean {
  return Boolean(
    (data.semesterCalendar &&
      data.semesterCalendar.semesterId === data.semester.id &&
      data.semesterCalendar.weeks.length) ||
    (data.currentSemester && data.currentSemester.id === data.semester.id),
  );
}

function weekDateRange(
  data: TimetableData,
  week: number,
): { startDate: string; endDate: string } | null {
  const calendar = data.semesterCalendar;
  if (calendar?.semesterId === data.semester.id) {
    const exact = calendar.weeks.find(
      (candidate) => candidate.weekNumber === week,
    );
    if (exact) return exact;
  }
  if (data.currentSemester?.id !== data.semester.id) return null;
  const startDate = campusDateAt(
    data.currentSemester.startDate,
    (week - 1) * 7,
  );
  return startDate ? { startDate, endDate: campusDateAt(startDate, 6) } : null;
}

function occurrenceDate(
  data: TimetableData,
  week: number,
  weekday: number,
): string | null {
  if (!datesAvailable(data)) return null;
  const range = weekDateRange(data, week);
  return range ? campusDateAt(range.startDate, weekday - 1) : null;
}

function toCourse(
  data: TimetableData,
  course: TimetableCourseData,
  arrangement: TimetableArrangement,
  week: number,
): TimetableCourse {
  const sourceDate = occurrenceDate(data, week, arrangement.weekday);
  const start =
    sourceDate && arrangement.startTime
      ? new Date(`${sourceDate}T${arrangement.startTime}:00${SOURCE_OFFSET}`)
      : null;
  const end =
    sourceDate && arrangement.endTime
      ? new Date(`${sourceDate}T${arrangement.endTime}:00${SOURCE_OFFSET}`)
      : null;
  const validStart = start && !Number.isNaN(start.getTime()) ? start : null;
  const validEnd = end && !Number.isNaN(end.getTime()) ? end : null;
  const teacherNames = arrangement.teacherNames.length
    ? arrangement.teacherNames
    : course.teacherNames;
  return {
    id: `${arrangement.id}:w${week}`,
    courseId: course.id,
    arrangementId: arrangement.id,
    weekday: validStart ? isoWeekday(validStart) : arrangement.weekday,
    sourceWeekday: arrangement.weekday,
    date: validStart ? toDateString(validStart) : null,
    startAt: validStart ? validStart.toISOString() : null,
    endAt: validEnd ? validEnd.toISOString() : null,
    localized: Boolean(validStart && validEnd),
    startTime: validStart
      ? localClock(validStart)
      : arrangement.startTime || "--:--",
    endTime: validEnd ? localClock(validEnd) : arrangement.endTime || "--:--",
    periodStart: arrangement.periodStart,
    periodEnd: arrangement.periodEnd,
    periodLabel:
      arrangement.periodStart === arrangement.periodEnd
        ? `${arrangement.periodStart} 节`
        : `${arrangement.periodStart}–${arrangement.periodEnd} 节`,
    displayTimeLabel:
      validStart && validEnd
        ? `${localClock(validStart)}–${localClock(validEnd)}`
        : arrangement.periodStart === arrangement.periodEnd
          ? `第 ${arrangement.periodStart} 节`
          : `第 ${arrangement.periodStart}–${arrangement.periodEnd} 节`,
    weekText: arrangement.weekText,
    weeks: arrangement.weeks,
    name: course.courseName,
    teacher: teacherNames.join("、") || "教师待定",
    teacherNames,
    location: arrangement.location.display || "地点待定",
    campus: arrangement.location.campus,
    tone: TONES[hash(course.id) % TONES.length],
    credits: course.credits,
    teachingClass: course.teachingClass,
    activityTypeLabel: arrangement.activityTypeLabel,
    selectionStatus: arrangement.selectionStatus,
    retake: course.retake,
    adjusted: arrangement.adjusted,
    category: course.category,
    nature: course.nature,
    assessmentMethod: course.assessmentMethod,
  };
}

function occursInWeek(
  arrangement: TimetableArrangement,
  week: number,
): boolean {
  return !arrangement.weeks.length || arrangement.weeks.includes(week);
}

export function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute)
    ? hour * 60 + minute
    : 0;
}

export function currentMinutes(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function currentIsoWeekday(
  date = new Date(),
): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return isoWeekday(date);
}

export function formatClock(date = new Date()): string {
  return localClock(date);
}

export function teachingWeekForDate(
  data: TimetableData | null,
  date = new Date(),
): number | null {
  if (!data || !datesAvailable(data)) return null;
  const currentDate = campusToday(date);
  const calendar = data.semesterCalendar;
  if (calendar?.semesterId === data.semester.id) {
    const exact = calendar.weeks.find(
      (week) => currentDate >= week.startDate && currentDate <= week.endDate,
    );
    return exact?.weekNumber ?? null;
  }
  if (!data.currentSemester) return null;
  if (
    currentDate < data.currentSemester.startDate ||
    currentDate > data.currentSemester.endDate
  ) {
    return null;
  }
  const start = Date.parse(
    `${data.currentSemester.startDate}T00:00:00${SOURCE_OFFSET}`,
  );
  const current = Date.parse(`${currentDate}T00:00:00${SOURCE_OFFSET}`);
  return Math.floor((current - start) / ONE_DAY / 7) + 1;
}

export function coursesForWeek(
  data: TimetableData | null,
  week: number,
): TimetableCourse[] {
  if (!data || week < 1) return [];
  return data.courses
    .flatMap((course) =>
      course.arrangements
        .filter((arrangement) => occursInWeek(arrangement, week))
        .map((arrangement) => toCourse(data, course, arrangement, week)),
    )
    .sort(
      (left, right) =>
        (left.date || "").localeCompare(right.date || "") ||
        timeToMinutes(left.startTime) - timeToMinutes(right.startTime),
    );
}

export function coursesForWeekday(
  data: TimetableData | null,
  weekday: number,
  week: number,
): TimetableCourse[] {
  return coursesForWeek(data, week).filter(
    (course) => course.weekday === weekday,
  );
}

export function coursesForDate(
  data: TimetableData | null,
  dateKey: string,
  now = new Date(),
): TimetableCourse[] {
  const currentWeek = teachingWeekForDate(data, now);
  if (!data || currentWeek === null) return [];
  return [currentWeek - 1, currentWeek, currentWeek + 1]
    .filter((week) => week > 0)
    .flatMap((week) => coursesForWeek(data, week))
    .filter((course) => course.date === dateKey)
    .filter(
      (course, index, courses) =>
        courses.findIndex((item) => item.id === course.id) === index,
    )
    .sort(
      (left, right) =>
        timeToMinutes(left.startTime) - timeToMinutes(right.startTime),
    );
}

export function remainingCourses(
  data: TimetableData | null,
  date = new Date(),
): TimetableCourse[] {
  const now = date.getTime();
  return coursesForDate(data, toDateString(date), date).filter((course) => {
    if (course.endAt) return new Date(course.endAt).getTime() > now;
    return timeToMinutes(course.endTime) > currentMinutes(date);
  });
}

export function coursePreview(
  data: TimetableData | null,
  date = new Date(),
  limit = 3,
): CoursePreviewSelection {
  const now = date.getTime();
  const remaining = remainingCourses(data, date);
  const currentCourse = remaining.find((course) => {
    if (course.startAt && course.endAt) {
      return (
        new Date(course.startAt).getTime() <= now &&
        new Date(course.endAt).getTime() > now
      );
    }
    const minutes = currentMinutes(date);
    return (
      minutes >= timeToMinutes(course.startTime) &&
      minutes < timeToMinutes(course.endTime)
    );
  });
  const safeLimit = Math.max(0, Math.floor(limit));
  const courses = currentCourse
    ? [
        currentCourse,
        ...remaining
          .filter((course) => course.id !== currentCourse.id)
          .slice(0, Math.max(0, safeLimit - 1)),
      ]
    : remaining.slice(0, safeLimit);
  return {
    courses: courses.slice(0, safeLimit),
    currentCourseId: currentCourse?.id ?? null,
  };
}

export function weekDateKeys(
  data: TimetableData | null,
  week: number,
): string[] {
  if (!data || !datesAvailable(data)) return [];
  const range = weekDateRange(data, week);
  if (!range) return [];
  return Array.from({ length: 7 }, (_, index) =>
    campusDateAt(range.startDate, index),
  );
}
