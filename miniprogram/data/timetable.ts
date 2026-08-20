import type {
  TimetableArrangement,
  TimetableCourseData,
  TimetableData,
} from "../types/api";

export type TimetableTone =
  | "blue"
  | "cyan"
  | "purple"
  | "green"
  | "orange"
  | "rose"
  | "yellow"
  | "mint";

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

export interface GridCourseTextInput {
  name: string;
  location: string;
  teacher: string;
}

export interface GridCourseTextMetrics {
  nameFontSizePx: number;
  locationFontSizePx: number;
  teacherFontSizePx: number;
  contentWidthPx: number;
  contentInsetPx: number;
  scale: number;
}

export interface GridCourseTextLayout {
  nameRows: GridCourseTextRow[];
  locationRows: GridCourseTextRow[];
  teacherRows: GridCourseTextRow[];
  nameLines: number;
  nameStyle: string;
  locationStyle: string;
  teacherStyle: string;
}

export interface GridCourseTextRow {
  key: string;
  text: string;
}

export interface TimetableWeekDateCache {
  weekNumber: number;
  dates: string[];
}

const SOURCE_OFFSET = "+08:00";
const ONE_DAY = 24 * 60 * 60 * 1000;
const TONES: TimetableTone[] = [
  "blue",
  "cyan",
  "purple",
  "green",
  "orange",
  "rose",
  "yellow",
  "mint",
];
const NAME_CHARACTERS_PER_LINE = 3;
const LOCATION_CHARACTERS_PER_LINE = 4;
const TEACHER_CHARACTERS_PER_LINE = 3;
const MAX_NAME_LINES = 4;
const MIN_NAME_LINES = 2;
const MAX_LOCATION_LINES = 3;
const MAX_TEACHER_LINES = 2;
const NAME_LINE_HEIGHT = 1.12;
const META_LINE_HEIGHT = 1.08;
const META_MARGIN_RPX = 3;

interface TimetableToneNode {
  key: string;
  arrangements: TimetableArrangement[];
}

const timetableToneMapCache = new WeakMap<
  TimetableData,
  ReadonlyMap<string, TimetableTone>
>();

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

function timetableCourseColorKey(course: TimetableCourseData): string {
  const code = course.courseCode.trim().toLowerCase();
  if (code) return `code:${code}`;
  const name = course.courseName.trim().replace(/\s+/g, " ").toLowerCase();
  return name ? `name:${name}` : `id:${course.id}`;
}

function arrangementsShareWeek(
  left: TimetableArrangement,
  right: TimetableArrangement,
): boolean {
  if (!left.weeks.length || !right.weeks.length) return true;
  const shorter = left.weeks.length <= right.weeks.length ? left : right;
  const longer = shorter === left ? right : left;
  return shorter.weeks.some((week) => longer.weeks.includes(week));
}

function arrangementVisualDistance(
  left: TimetableArrangement,
  right: TimetableArrangement,
): number {
  if (!arrangementsShareWeek(left, right)) return Number.POSITIVE_INFINITY;
  const dayDistance = Math.abs(left.weekday - right.weekday) * 2.25;
  const leftMiddle = (left.periodStart + left.periodEnd) / 2;
  const rightMiddle = (right.periodStart + right.periodEnd) / 2;
  const periodDistance = Math.abs(leftMiddle - rightMiddle);
  return Math.sqrt(dayDistance ** 2 + periodDistance ** 2);
}

function courseVisualDistance(
  left: TimetableToneNode,
  right: TimetableToneNode,
): number {
  let minimum = Number.POSITIVE_INFINITY;
  left.arrangements.forEach((leftArrangement) => {
    right.arrangements.forEach((rightArrangement) => {
      minimum = Math.min(
        minimum,
        arrangementVisualDistance(leftArrangement, rightArrangement),
      );
    });
  });
  return minimum;
}

function firstArrangementSlot(node: TimetableToneNode): number {
  return node.arrangements.reduce(
    (minimum, arrangement) =>
      Math.min(
        minimum,
        arrangement.weekday * 100 + arrangement.periodStart,
      ),
    Number.POSITIVE_INFINITY,
  );
}

function timetableCourseToneMap(
  data: TimetableData,
): ReadonlyMap<string, TimetableTone> {
  const cached = timetableToneMapCache.get(data);
  if (cached) return cached;

  const nodesByKey = new Map<string, TimetableToneNode>();
  data.courses.forEach((course) => {
    const key = timetableCourseColorKey(course);
    const existing = nodesByKey.get(key);
    if (existing) {
      existing.arrangements.push(...course.arrangements);
      return;
    }
    nodesByKey.set(key, { key, arrangements: [...course.arrangements] });
  });
  const nodes = [...nodesByKey.values()].sort(
    (left, right) =>
      firstArrangementSlot(left) - firstArrangementSlot(right) ||
      left.key.localeCompare(right.key),
  );
  const assignedNodes = new Map<TimetableTone, TimetableToneNode[]>(
    TONES.map((tone) => [tone, []]),
  );
  const toneMap = new Map<string, TimetableTone>();

  nodes.forEach((node) => {
    const preferredIndex = hash(node.key) % TONES.length;
    let selectedTone = TONES[preferredIndex];
    let selectedDistance = -1;
    let selectedUsage = Number.POSITIVE_INFINITY;
    for (let offset = 0; offset < TONES.length; offset += 1) {
      const tone = TONES[(preferredIndex + offset) % TONES.length];
      const owners = assignedNodes.get(tone) || [];
      const distance = owners.length
        ? Math.min(...owners.map((owner) => courseVisualDistance(node, owner)))
        : Number.POSITIVE_INFINITY;
      if (
        distance > selectedDistance ||
        (distance === selectedDistance && owners.length < selectedUsage)
      ) {
        selectedTone = tone;
        selectedDistance = distance;
        selectedUsage = owners.length;
      }
    }
    toneMap.set(node.key, selectedTone);
    assignedNodes.get(selectedTone)?.push(node);
  });
  timetableToneMapCache.set(data, toneMap);
  return toneMap;
}

function truncateGridText(value: string, maxCharacters: number): string {
  const characters = Array.from(value.trim());
  return characters.length <= maxCharacters
    ? characters.join("")
    : `${characters.slice(0, maxCharacters - 1).join("")}…`;
}

function gridTextRows(
  value: string,
  charactersPerLine: number,
  keyPrefix: string,
): GridCourseTextRow[] {
  const characters = Array.from(value);
  const rows: GridCourseTextRow[] = [];
  for (let index = 0; index < characters.length; index += charactersPerLine) {
    rows.push({
      key: `${keyPrefix}-${rows.length}`,
      text: characters.slice(index, index + charactersPerLine).join(""),
    });
  }
  return rows;
}

function gridLocation(value: string): string {
  const location = value.trim().replace(/^@+/, "");
  return location ? `@${location}` : "";
}

function isFullWidthGridCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) || 0;
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff01 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}

function gridCharacterWidthUnits(character: string): number {
  if (isFullWidthGridCharacter(character) || character === "…") return 1;
  if (character === "@") return 0.95;
  if (/[MW]/.test(character)) return 0.9;
  if (/[A-Z]/.test(character)) return 0.7;
  if (/[0-9]/.test(character)) return 0.6;
  if (/[a-z]/.test(character)) return 0.55;
  if (/\s/.test(character)) return 0.35;
  if (/[-_.,:;!|'"`()\[\]{}]/.test(character)) return 0.4;
  return 0.65;
}

function fittedGridRowsFontSize(
  rows: GridCourseTextRow[],
  maximumFontSizePx: number,
  contentWidthPx: number,
): number {
  if (!rows.length) return maximumFontSizePx;
  const widestRow = Math.max(
    1,
    ...rows.map((row) =>
      Array.from(row.text).reduce(
        (width, character) => width + gridCharacterWidthUnits(character),
        0,
      ),
    ),
  );
  return Math.max(
    1,
    Math.min(maximumFontSizePx, (contentWidthPx - 1) / widestRow),
  );
}

function gridTextStyle(
  fontSizePx: number,
  lineHeightRatio: number,
  maximumLines: number,
): string {
  const lineHeightPx = fontSizePx * lineHeightRatio;
  return [
    `font-size:${fontSizePx.toFixed(2)}px`,
    `line-height:${lineHeightPx.toFixed(2)}px`,
    `max-height:${(lineHeightPx * maximumLines).toFixed(2)}px`,
  ].join(";");
}

/**
 * 课程名只在地点会被卡片底边裁掉时从四行依次收至三行、两行。
 * 教师允许自然延伸到卡片底边之外，因此不会反向挤压前两段文字。
 */
export function layoutGridCourseText(
  input: GridCourseTextInput,
  cardHeightPx: number,
  metrics: GridCourseTextMetrics,
): GridCourseTextLayout {
  const locationText = truncateGridText(
    gridLocation(input.location),
    LOCATION_CHARACTERS_PER_LINE * MAX_LOCATION_LINES,
  );
  const teacherText = truncateGridText(
    input.teacher,
    TEACHER_CHARACTERS_PER_LINE * MAX_TEACHER_LINES,
  );
  const rawNameLength = Array.from(input.name.trim()).length;
  const locationRows = gridTextRows(
    locationText,
    LOCATION_CHARACTERS_PER_LINE,
    "location",
  );
  const locationLines = locationRows.length;
  const locationFontSizePx = fittedGridRowsFontSize(
    locationRows,
    metrics.locationFontSizePx,
    metrics.contentWidthPx,
  );
  const availableHeight = Math.max(0, cardHeightPx - metrics.contentInsetPx);
  const locationHeight = locationLines * locationFontSizePx * META_LINE_HEIGHT;
  const locationMargin = locationLines ? META_MARGIN_RPX * metrics.scale : 0;
  const locationFitsAfterName = (limit: number): boolean => {
    if (!locationLines) return true;
    const nameLines = Math.max(
      1,
      Math.min(limit, Math.ceil(rawNameLength / NAME_CHARACTERS_PER_LINE)),
    );
    const nameHeight = nameLines * metrics.nameFontSizePx * NAME_LINE_HEIGHT;
    return nameHeight + locationMargin + locationHeight <= availableHeight;
  };

  let nameLines = MAX_NAME_LINES;
  while (nameLines > MIN_NAME_LINES && !locationFitsAfterName(nameLines)) {
    nameLines -= 1;
  }

  const nameText = truncateGridText(
    input.name,
    nameLines * NAME_CHARACTERS_PER_LINE,
  );
  return {
    nameRows: gridTextRows(nameText, NAME_CHARACTERS_PER_LINE, "name"),
    locationRows,
    teacherRows: gridTextRows(
      teacherText,
      TEACHER_CHARACTERS_PER_LINE,
      "teacher",
    ),
    nameLines,
    nameStyle: gridTextStyle(
      metrics.nameFontSizePx,
      NAME_LINE_HEIGHT,
      nameLines,
    ),
    locationStyle: gridTextStyle(
      locationFontSizePx,
      META_LINE_HEIGHT,
      MAX_LOCATION_LINES,
    ),
    teacherStyle: gridTextStyle(
      metrics.teacherFontSizePx,
      META_LINE_HEIGHT,
      MAX_TEACHER_LINES,
    ),
  };
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
  tone: TimetableTone,
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
    tone,
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

/**
 * 进入课表时要展示的周次。教学周内显示当前周；学期尚未开始时显示
 * 第一周；学期结束后显示最后一周。结构化周次存在间隔时选择离今天
 * 最近的一周，避免假期首屏退回无意义的第一周。
 */
export function timetableWeekForDisplay(
  data: TimetableData | null,
  date = new Date(),
): number {
  if (!data) return 1;
  const maximum = timetableWeekCount(data);
  const teachingWeek = teachingWeekForDate(data, date);
  if (teachingWeek !== null) {
    return Math.min(maximum, Math.max(1, teachingWeek));
  }

  const currentDate = campusToday(date);
  const calendar = data.semesterCalendar;
  if (calendar?.semesterId === data.semester.id && calendar.weeks.length) {
    if (currentDate < calendar.startDate) return 1;
    if (currentDate > calendar.endDate) return maximum;
    const weeks = [...calendar.weeks].sort(
      (left, right) => left.weekNumber - right.weekNumber,
    );
    const next = weeks.find((week) => currentDate < week.startDate);
    if (next) return Math.min(maximum, Math.max(1, next.weekNumber));
    const previous = [...weeks]
      .reverse()
      .find((week) => currentDate > week.endDate);
    if (previous) {
      return Math.min(maximum, Math.max(1, previous.weekNumber));
    }
  }

  if (data.currentSemester?.id === data.semester.id) {
    if (currentDate < data.currentSemester.startDate) return 1;
    if (currentDate > data.currentSemester.endDate) return maximum;
  }
  return 1;
}

export function coursesForWeek(
  data: TimetableData | null,
  week: number,
): TimetableCourse[] {
  if (!data || week < 1) return [];
  const toneMap = timetableCourseToneMap(data);
  return data.courses
    .flatMap((course) =>
      course.arrangements
        .filter((arrangement) => occursInWeek(arrangement, week))
        .map((arrangement) =>
          toCourse(
            data,
            course,
            arrangement,
            week,
            toneMap.get(timetableCourseColorKey(course)) || TONES[0],
          ),
        ),
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

export function timetableWeekCount(data: TimetableData): number {
  return Math.max(
    1,
    data.summary.maxWeek,
    data.semesterCalendar?.totalWeeks || 0,
  );
}

export function buildTimetableWeekDateCache(
  data: TimetableData,
): TimetableWeekDateCache[] {
  return Array.from({ length: timetableWeekCount(data) }, (_, index) => ({
    weekNumber: index + 1,
    dates: weekDateKeys(data, index + 1),
  }));
}
