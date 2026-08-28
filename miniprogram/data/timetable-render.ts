import {
  coursesForWeek,
  layoutGridCourseText,
  teachingWeekForDate,
  timetableWeekCount,
  timetableWeekForDisplay,
  weekDateKeys,
  type TimetableCourse,
  type TimetableWeekDateCache,
} from "./timetable";
import type { TimetableData, TimetablePeriod } from "../types/api";
import type { TimetableThemeId } from "./timetable-theme";

const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export interface TimetableDayOption {
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  shortLabel: string;
  dateLabel: string;
  date: string;
  isToday: boolean;
}

export interface TimetableGridCourse extends TimetableCourse {
  topPercent: string;
  heightPercent: string;
  topInsetPx: string;
  nameRows: Array<{ key: string; text: string }>;
  locationRows: Array<{ key: string; text: string }>;
  teacherRows: Array<{ key: string; text: string }>;
  nameLines: number;
  nameStyle: string;
  locationStyle: string;
  teacherStyle: string;
}

export interface TimetableGridDay extends TimetableDayOption {
  courses: TimetableGridCourse[];
}

export interface TimetableWeekPage {
  weekNumber: number;
  monthNumber: string;
  startDateLabel: string;
  ready: boolean;
  days: TimetableDayOption[];
  gridDays: TimetableGridDay[];
}

export interface TimetablePeriodRow {
  period: number;
  startTime: string;
  endTime: string;
}

export interface TimetableGridLayoutMetrics {
  rowHeightPx: number;
  courseTopInsetPx: number;
  courseHeightExtensionPx: number;
  nameFontSizePx: number;
  locationFontSizePx: number;
  teacherFontSizePx: number;
  contentWidthPx: number;
  contentInsetPx: number;
  scale: number;
  viewportKey: string;
}

export interface TimetableRenderSnapshot {
  data: TimetableData;
  weekDates: TimetableWeekDateCache[];
  localStoredAt: number;
}

export interface TimetableFirstScreen {
  account: string;
  themeId: TimetableThemeId;
  semesterId: string;
  localStoredAt: number;
  viewportKey: string;
  weekNumber: number;
  currentWeekNumber: number;
  maxWeek: number;
  maxPeriod: number;
  courses: TimetableCourse[];
  periodRows: TimetablePeriodRow[];
  weekPage: TimetableWeekPage;
}

let prewarmedFirstScreen: TimetableFirstScreen | null = null;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function buildDays(
  timetable: TimetableData,
  week: number,
  cachedDates?: string[],
  now = new Date(),
): TimetableDayOption[] {
  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )}`;
  const dates = resolvedWeekDates(timetable, week, cachedDates);
  return DAY_LABELS.map((shortLabel, index) => {
    const date = dates[index] || "";
    return {
      weekday: (index + 1) as TimetableDayOption["weekday"],
      shortLabel,
      dateLabel: date ? String(Number(date.slice(-2))) : "—",
      date,
      isToday: date === todayKey,
    };
  });
}

function courseOccursOnDay(
  course: TimetableCourse,
  day: TimetableDayOption,
): boolean {
  return day.date
    ? course.sourceDate === day.date
    : course.sourceWeekday === day.weekday;
}

export function timetableMaxPeriod(timetable: TimetableData): number {
  const periods = timetable.periods.map((item) => item.period);
  const coursePeriods = timetable.courses.flatMap((course) =>
    course.arrangements.map((arrangement) => arrangement.periodEnd),
  );
  return Math.max(12, ...periods, ...coursePeriods);
}

function toGridCourse(
  course: TimetableCourse,
  maxPeriod: number,
  metrics: TimetableGridLayoutMetrics,
): TimetableGridCourse {
  const start = Math.max(1, Math.min(maxPeriod, course.periodStart));
  const end = Math.max(start, Math.min(maxPeriod, course.periodEnd));
  const span = end - start + 1;
  const gridHeightPx = metrics.rowHeightPx * maxPeriod;
  const heightExtensionPx =
    end < maxPeriod ? metrics.courseHeightExtensionPx : 0;
  const textMetrics = heightExtensionPx
    ? metrics
    : {
        ...metrics,
        contentInsetPx:
          metrics.contentInsetPx + metrics.courseHeightExtensionPx,
      };
  return {
    ...course,
    topPercent: (((start - 1) / maxPeriod) * 100).toFixed(5),
    heightPercent: (
      ((span * metrics.rowHeightPx + heightExtensionPx) / gridHeightPx) *
      100
    ).toFixed(5),
    topInsetPx: metrics.courseTopInsetPx.toFixed(2),
    ...layoutGridCourseText(course, span * metrics.rowHeightPx, textMetrics),
  };
}

function viewportSize(): {
  width: number;
  height: number;
} {
  try {
    const windowInfo = wx.getWindowInfo();
    return {
      width: windowInfo.windowWidth || 375,
      height: windowInfo.windowHeight || 667,
    };
  } catch {
    return { width: 375, height: 667 };
  }
}

export function timetableHeaderHeight(): number {
  try {
    const windowInfo = wx.getWindowInfo();
    const menu = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = windowInfo.statusBarHeight || menu.top || 24;
    const controlSize = menu.height || 32;
    const controlTop = menu.top || statusBarHeight + 4;
    return (
      statusBarHeight +
      Math.max(0, controlTop - statusBarHeight) * 2 +
      controlSize
    );
  } catch {
    return 64;
  }
}

export function timetableGridLayoutMetrics(
  maxPeriod: number,
  headerHeight = timetableHeaderHeight(),
): TimetableGridLayoutMetrics {
  const viewport = viewportSize();
  const scale = viewport.width / 750;
  const columnWidth = (viewport.width - 84 * scale) / 7;
  // 槽内边距 4rpx、课程边框 6rpx、课程内边距 8rpx。
  const contentWidth = Math.max(1, columnWidth - 18 * scale);
  const widthSafetyPx = 1;
  const fittedFontSize = (charactersPerLine: number, maximum: number) =>
    Math.max(
      1,
      Math.min(maximum, (contentWidth - widthSafetyPx) / charactersPerLine),
    );
  const gridHeight = Math.max(160, viewport.height - headerHeight - 84 * scale);
  const rowHeightPx = gridHeight / Math.max(1, maxPeriod);
  // 左侧节次由 25rpx 数字、两行 16rpx 时间和两个 5rpx 间距组成。
  // 课程卡片比这组内容的顶部略高 3rpx，保留轻微超出而不贴住整行边界。
  const periodLabelHeightPx = 67 * scale;
  const courseTopInsetPx = Math.max(
    2 * scale,
    (rowHeightPx - periodLabelHeightPx) / 2 - 3 * scale,
  );
  // 下沿比顶部偏移少延长 1rpx，与槽底部 2rpx 合计形成 3rpx 课程间距。
  const courseHeightExtensionPx = Math.max(0, courseTopInsetPx - scale);
  return {
    rowHeightPx,
    courseTopInsetPx,
    courseHeightExtensionPx,
    nameFontSizePx: fittedFontSize(3, 15),
    locationFontSizePx: fittedFontSize(3, 14),
    teacherFontSizePx: fittedFontSize(3, 12),
    contentWidthPx: contentWidth,
    // 扣除未被下沿补回的顶部距离、底部 2rpx、边框和内边距。
    contentInsetPx: courseTopInsetPx - courseHeightExtensionPx + 16 * scale,
    scale,
    viewportKey: `${viewport.width}x${viewport.height}:${headerHeight}`,
  };
}

function monthNumber(days: TimetableDayOption[]): string {
  const datedDays = days.filter((day) => day.date);
  const displayDate = datedDays[datedDays.length - 1]?.date;
  return displayDate ? String(Number(displayDate.slice(5, 7))) : "—";
}

function weekStartDateLabel(dates: string[]): string {
  const date = dates.find(Boolean);
  return date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : "";
}

function resolvedWeekDates(
  timetable: TimetableData,
  weekNumber: number,
  cachedDates?: string[],
): string[] {
  const calculatedDates = weekDateKeys(timetable, weekNumber);
  if (!cachedDates?.some(Boolean)) return calculatedDates;
  return Array.from(
    { length: 7 },
    (_, index) => cachedDates[index] || calculatedDates[index] || "",
  );
}

export function buildTimetableWeekPlaceholder(
  timetable: TimetableData,
  weekNumber: number,
  cachedDates?: string[],
): TimetableWeekPage {
  const dates = resolvedWeekDates(timetable, weekNumber, cachedDates);
  return {
    weekNumber,
    monthNumber: "—",
    startDateLabel: weekStartDateLabel(dates),
    ready: false,
    days: [],
    gridDays: [],
  };
}

export function buildTimetableWeekPage(
  timetable: TimetableData,
  weekNumber: number,
  maxPeriod: number,
  metrics: TimetableGridLayoutMetrics,
  cachedDates?: string[],
  now = new Date(),
): TimetableWeekPage {
  const courses = coursesForWeek(timetable, weekNumber);
  const days = buildDays(timetable, weekNumber, cachedDates, now);
  return {
    weekNumber,
    monthNumber: monthNumber(days),
    startDateLabel: weekStartDateLabel(days.map((day) => day.date)),
    ready: true,
    days,
    gridDays: days.map((day) => ({
      ...day,
      courses: courses
        .filter((course) => courseOccursOnDay(course, day))
        .map((course) => toGridCourse(course, maxPeriod, metrics)),
    })),
  };
}

export function buildTimetablePeriodRows(
  timetable: TimetableData,
  maxPeriod: number,
  courses: TimetableCourse[],
): TimetablePeriodRow[] {
  const source = new Map<number, TimetablePeriod>(
    timetable.periods.map((period) => [period.period, period]),
  );
  const starts = new Map<number, string>();
  const ends = new Map<number, string>();
  for (const course of courses) {
    if (course.startTime !== "--:--") {
      starts.set(course.periodStart, course.startTime);
    }
    if (course.endTime !== "--:--") ends.set(course.periodEnd, course.endTime);
  }
  return Array.from({ length: maxPeriod }, (_, index) => {
    const period = index + 1;
    return {
      period,
      startTime: starts.get(period) || source.get(period)?.startTime || "--:--",
      endTime: ends.get(period) || source.get(period)?.endTime || "--:--",
    };
  });
}

export function buildTimetableFirstScreen(
  account: string,
  snapshot: TimetableRenderSnapshot,
  headerHeight = timetableHeaderHeight(),
  now = new Date(),
  themeId: TimetableThemeId = "default",
): TimetableFirstScreen {
  const timetable = snapshot.data;
  const maxWeek = timetableWeekCount(timetable);
  const maxPeriod = timetableMaxPeriod(timetable);
  const weekNumber = timetableWeekForDisplay(timetable, now);
  const currentWeekNumber = teachingWeekForDate(timetable, now) || 0;
  const metrics = timetableGridLayoutMetrics(maxPeriod, headerHeight);
  const cachedDates = snapshot.weekDates.find(
    (week) => week.weekNumber === weekNumber,
  )?.dates;
  const courses = coursesForWeek(timetable, weekNumber);
  return {
    account,
    themeId,
    semesterId: timetable.semester.id,
    localStoredAt: snapshot.localStoredAt,
    viewportKey: metrics.viewportKey,
    weekNumber,
    currentWeekNumber,
    maxWeek,
    maxPeriod,
    courses,
    periodRows: buildTimetablePeriodRows(timetable, maxPeriod, courses),
    weekPage: buildTimetableWeekPage(
      timetable,
      weekNumber,
      maxPeriod,
      metrics,
      cachedDates,
      now,
    ),
  };
}

export function prewarmTimetableFirstScreen(
  account: string,
  snapshot: TimetableRenderSnapshot,
  themeId: TimetableThemeId = "default",
): TimetableFirstScreen {
  prewarmedFirstScreen = buildTimetableFirstScreen(
    account,
    snapshot,
    timetableHeaderHeight(),
    new Date(),
    themeId,
  );
  return prewarmedFirstScreen;
}

export function getPrewarmedTimetableFirstScreen(
  account: string,
  snapshot: TimetableRenderSnapshot,
  metrics: TimetableGridLayoutMetrics,
  themeId: TimetableThemeId = "default",
): TimetableFirstScreen | null {
  const cached = prewarmedFirstScreen;
  return cached &&
    cached.account === account &&
    cached.themeId === themeId &&
    cached.semesterId === snapshot.data.semester.id &&
    cached.localStoredAt === snapshot.localStoredAt &&
    cached.viewportKey === metrics.viewportKey
    ? cached
    : null;
}
