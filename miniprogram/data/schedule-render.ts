import {
  coursesForDate,
  currentIsoWeekday,
  formatClock,
  teachingWeekForDate,
  timeToMinutes,
  type TimetableCourse,
} from "./timetable";
import {
  layoutScheduleOverlaps,
  vacationLabelForDate,
  type ScheduleColumnLayout,
} from "./schedule";
import type {
  LocalScheduleData,
  LocalSchedulePlan,
  TimetableData,
} from "../types/api";
import { formatFriendlyDate, toDateString } from "../utils/date";

export interface ScheduleDayOption {
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  shortLabel: string;
  dateLabel: string;
  date: string;
  isToday: boolean;
  hasPlan: boolean;
}

interface ScheduleEntryBase {
  id: string;
  kind: "course" | "plan";
  title: string;
  subtitle: string;
  startTime: string;
  endTime: string;
  timeLabel: string;
  tone: TimetableCourse["tone"] | "plan";
  done: boolean;
  top: number;
  height: number;
}

export interface ScheduleEntry extends ScheduleEntryBase, ScheduleColumnLayout {
  displayMeta: string;
}

export interface ScheduleDayView {
  selectedWeekday: ScheduleDayOption["weekday"];
  selectedDate: string;
  monthLabel: string;
  teachingWeekLabel: string;
  selectedDateLabel: string;
  entries: ScheduleEntry[];
}

export interface ScheduleWeekView extends ScheduleDayView {
  currentTime: string;
  days: ScheduleDayOption[];
}

export interface PrewarmedScheduleFirstScreen {
  revision: number;
  account: string;
  builtForDate: string;
  timetableStoredAt: number;
  scheduleUpdatedAt: string | null;
  timetable: TimetableData | null;
  schedule: LocalScheduleData;
  view: ScheduleWeekView;
}

const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const DAY_START = 8 * 60;
const DAY_END = 22 * 60 + 30;
const RPX_PER_MINUTE = 1.55;

export const SCHEDULE_TIMELINE_HEIGHT = Math.round(
  (DAY_END - DAY_START) * RPX_PER_MINUTE,
);

let prewarmedFirstScreen: PrewarmedScheduleFirstScreen | null = null;
let prewarmRevision = 0;

function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = date.getDay() || 7;
  monday.setDate(monday.getDate() - weekday + 1);
  return monday;
}

function entryGeometry(startTime: string, endTime: string) {
  const start = Math.max(DAY_START, timeToMinutes(startTime));
  const end = Math.min(DAY_END, Math.max(start + 30, timeToMinutes(endTime)));
  return {
    top: Math.round((start - DAY_START) * RPX_PER_MINUTE),
    height: Math.max(74, Math.round((end - start) * RPX_PER_MINUTE)),
  };
}

export function scheduleDateFromKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function buildScheduleEntries(
  timetable: TimetableData | null,
  date: string,
  plans: LocalSchedulePlan[],
): ScheduleEntry[] {
  const selectedDate = scheduleDateFromKey(date);
  const courses: ScheduleEntryBase[] = coursesForDate(
    timetable,
    date,
    selectedDate,
  ).map((course) => ({
    id: course.id,
    kind: "course" as const,
    title: course.name,
    subtitle: `${course.location} · ${course.teacher}`,
    startTime: course.startTime,
    endTime: course.endTime,
    timeLabel: `${course.periodLabel} · ${course.startTime}–${course.endTime}`,
    tone: course.tone,
    done: false,
    ...entryGeometry(course.startTime, course.endTime),
  }));
  const planEntries: ScheduleEntryBase[] = plans
    .filter((plan) => plan.date === date)
    .map((plan) => ({
      id: plan.id,
      kind: "plan" as const,
      title: plan.title,
      subtitle:
        plan.endDate === plan.date ? "日程" : `日程 · 延续至 ${plan.endDate}`,
      startTime: plan.startTime,
      endTime: plan.endTime,
      timeLabel: `${plan.startTime}–${plan.endDate === plan.date ? "" : "次日 "}${plan.endTime}`,
      tone: "plan" as const,
      done: plan.done,
      ...entryGeometry(
        plan.startTime,
        plan.endDate === plan.date ? plan.endTime : "22:30",
      ),
    }));
  return layoutScheduleOverlaps([...courses, ...planEntries]).map((entry) => ({
    ...entry,
    displayMeta: entry.compact
      ? entry.timeLabel
      : `${entry.timeLabel} · ${entry.subtitle}`,
  }));
}

export function buildScheduleDayView(
  timetable: TimetableData | null,
  days: ScheduleDayOption[],
  plans: LocalSchedulePlan[],
  weekday: ScheduleDayOption["weekday"],
): ScheduleDayView | null {
  const selected = days.find((day) => day.weekday === weekday);
  if (!selected) return null;
  const selectedDate = scheduleDateFromKey(selected.date);
  const teachingWeek = teachingWeekForDate(timetable, selectedDate);
  return {
    selectedWeekday: weekday,
    selectedDate: selected.date,
    monthLabel: `${selectedDate.getMonth() + 1} 月`,
    teachingWeekLabel:
      teachingWeek === null
        ? vacationLabelForDate(timetable, selected.date) || ""
        : `第 ${teachingWeek} 教学周`,
    selectedDateLabel: `${formatFriendlyDate(selected.date)}${selected.isToday ? " · 今天" : ""}`,
    entries: buildScheduleEntries(timetable, selected.date, plans),
  };
}

export function buildScheduleWeekView(
  timetable: TimetableData | null,
  plans: LocalSchedulePlan[],
  selectedWeekday: ScheduleDayOption["weekday"] = currentIsoWeekday(),
  now = new Date(),
): ScheduleWeekView {
  const monday = mondayOf(now);
  const todayKey = toDateString(now);
  const days = DAY_LABELS.map((shortLabel, index) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + index);
    const weekday = (index + 1) as ScheduleDayOption["weekday"];
    const dateKey = toDateString(date);
    return {
      weekday,
      shortLabel,
      dateLabel: String(date.getDate()),
      date: dateKey,
      isToday: dateKey === todayKey,
      hasPlan: plans.some((plan) => plan.date === dateKey),
    };
  });
  const selected =
    buildScheduleDayView(timetable, days, plans, selectedWeekday) ||
    buildScheduleDayView(timetable, days, plans, days[0].weekday);
  if (!selected) {
    throw new Error("无法构建当前周日程。");
  }
  return {
    currentTime: formatClock(now),
    days,
    ...selected,
  };
}

export function prewarmScheduleFirstScreen(
  account: string,
  timetable: TimetableData | null,
  schedule: LocalScheduleData,
  versions: { timetableStoredAt?: number } = {},
  now = new Date(),
): PrewarmedScheduleFirstScreen {
  prewarmedFirstScreen = {
    revision: (prewarmRevision += 1),
    account,
    builtForDate: toDateString(now),
    timetableStoredAt: versions.timetableStoredAt || 0,
    scheduleUpdatedAt: schedule.clientUpdatedAt,
    timetable,
    schedule,
    view: buildScheduleWeekView(
      timetable,
      schedule.plans,
      currentIsoWeekday(now),
      now,
    ),
  };
  return prewarmedFirstScreen;
}

export function getPrewarmedScheduleFirstScreen(
  account: string,
  now = new Date(),
): PrewarmedScheduleFirstScreen | null {
  const cached = prewarmedFirstScreen;
  return cached &&
    cached.account === account &&
    cached.builtForDate === toDateString(now)
    ? cached
    : null;
}
