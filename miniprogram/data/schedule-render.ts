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
  placement: "timeline" | "early" | "late";
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
  timelineEntries: ScheduleEntry[];
  earlyEntries: ScheduleEntry[];
  lateEntries: ScheduleEntry[];
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
  pager?: ReturnType<typeof buildSchedulePager>;
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
  const start = Math.max(
    DAY_START,
    Math.min(DAY_END, timeToMinutes(startTime)),
  );
  const end = Math.min(DAY_END, Math.max(start, timeToMinutes(endTime)));
  const height = Math.max(74, Math.round((end - start) * RPX_PER_MINUTE));
  return {
    top: Math.min(
      SCHEDULE_TIMELINE_HEIGHT - height,
      Math.round((start - DAY_START) * RPX_PER_MINUTE),
    ),
    height,
    placement:
      timeToMinutes(endTime) <= DAY_START
        ? ("early" as const)
        : timeToMinutes(startTime) >= DAY_END
          ? ("late" as const)
          : ("timeline" as const),
  };
}

export function scheduleDateFromKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function shiftScheduleDate(value: string, offset: number): string {
  const date = scheduleDateFromKey(value);
  date.setDate(date.getDate() + offset);
  return toDateString(date);
}

export function planOccursOnDate(
  plan: LocalSchedulePlan,
  date: string,
): boolean {
  return (
    plan.date <= date &&
    (plan.endDate > date || (plan.endDate === date && plan.endTime > "00:00"))
  );
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
    .filter((plan) => planOccursOnDate(plan, date))
    .map((plan) => ({
      id: plan.id,
      kind: "plan" as const,
      title: plan.title,
      subtitle:
        plan.date < date
          ? "日程 · 延续"
          : plan.endDate === plan.date
            ? "日程"
            : `日程 · 延续至 ${plan.endDate}`,
      startTime: plan.date < date ? "00:00" : plan.startTime,
      endTime: plan.endDate > date ? "24:00" : plan.endTime,
      timeLabel:
        plan.date === plan.endDate
          ? `${plan.startTime}–${plan.endTime}`
          : `${plan.date} ${plan.startTime}–${plan.endDate} ${plan.endTime}`,
      tone: "plan" as const,
      done: plan.done,
      ...entryGeometry(
        plan.date < date ? "00:00" : plan.startTime,
        plan.endDate > date ? "24:00" : plan.endTime,
      ),
    }));
  const allEntries = [...courses, ...planEntries];
  const timeline = layoutScheduleOverlaps(
    allEntries.filter((entry) => entry.placement === "timeline"),
  );
  const outside = allEntries
    .filter((entry) => entry.placement !== "timeline")
    .sort(
      (a, b) =>
        a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id),
    )
    .map((entry) => layoutScheduleOverlaps([entry])[0]);
  return [...timeline, ...outside].map((entry) => ({
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
  const entries = buildScheduleEntries(timetable, selected.date, plans);
  return {
    selectedWeekday: weekday,
    selectedDate: selected.date,
    monthLabel: `${selectedDate.getFullYear()} 年 ${selectedDate.getMonth() + 1} 月`,
    teachingWeekLabel:
      teachingWeek === null
        ? vacationLabelForDate(timetable, selected.date) || ""
        : `第 ${teachingWeek} 教学周`,
    selectedDateLabel: `${formatFriendlyDate(selected.date)}${selected.isToday ? " · 今天" : ""}`,
    entries,
    timelineEntries: entries.filter((entry) => entry.placement === "timeline"),
    earlyEntries: entries.filter((entry) => entry.placement === "early"),
    lateEntries: entries.filter((entry) => entry.placement === "late"),
  };
}

export function buildScheduleWeekView(
  timetable: TimetableData | null,
  plans: LocalSchedulePlan[],
  selectedWeekday: ScheduleDayOption["weekday"] = currentIsoWeekday(),
  now = new Date(),
  anchorDate = now,
): ScheduleWeekView {
  const monday = mondayOf(anchorDate);
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
      hasPlan: plans.some((plan) => planOccursOnDate(plan, dateKey)),
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

export function buildScheduleDateView(
  timetable: TimetableData | null,
  plans: LocalSchedulePlan[],
  date: string,
  now = new Date(),
): ScheduleWeekView {
  const anchor = scheduleDateFromKey(date);
  return buildScheduleWeekView(
    timetable,
    plans,
    currentIsoWeekday(anchor),
    now,
    anchor,
  );
}

// Calendar arithmetic uses UTC fields, independent of local DST. The offset
// makes every Monday divisible by seven; it is only an animation coordinate.
export function scheduleDayIndex(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000 + 3;
}

export function buildSchedulePager(
  timetable: TimetableData | null,
  plans: LocalSchedulePlan[],
  date: string,
  windowStart?: string,
  now = new Date(),
) {
  const weekday = currentIsoWeekday(scheduleDateFromKey(date)) - 1;
  const firstDate = windowStart || shiftScheduleDate(date, -weekday - 7);
  // Native indices always follow calendar order. Never replace an adjacent
  // date with a tap target or recycle an item during a native transition.
  const dayPages = Array.from({ length: 21 }, (_, slot) => {
    return {
      slot,
      ...buildScheduleDateView(
        timetable,
        plans,
        shiftScheduleDate(firstDate, slot),
        now,
      ),
    };
  });
  return assembleSchedulePager(dayPages, timetable, plans, date, now);
}

function assembleSchedulePager(
  dayPages: Array<ScheduleWeekView & { slot: number }>,
  timetable: TimetableData | null,
  plans: LocalSchedulePlan[],
  date: string,
  now: Date,
) {
  const weekIndex = Math.floor(scheduleDayIndex(date) / 7);
  const weekPages = [0, 1, 2].map((slot) => {
    const offset = (slot - (weekIndex % 3) + 3) % 3;
    const relativeWeek = offset === 2 ? -1 : offset;
    return {
      slot,
      days: buildScheduleDateView(
        timetable,
        plans,
        shiftScheduleDate(date, relativeWeek * 7),
        now,
      ).days,
    };
  });
  return {
    dayPages,
    weekPages,
    dayCurrent: dayPages.findIndex((day) => day.selectedDate === date),
  };
}

/** Yield between small batches so preparation can run while the home page is visible. */
export async function prewarmSchedulePager(
  firstScreen: PrewarmedScheduleFirstScreen,
  isCurrent: () => boolean,
  now = new Date(),
): Promise<void> {
  const date = firstScreen.builtForDate;
  const weekday = currentIsoWeekday(scheduleDateFromKey(date)) - 1;
  const firstDate = shiftScheduleDate(date, -weekday - 7);
  const dayPages: Array<ScheduleWeekView & { slot: number }> = [];
  for (let slot = 0; slot < 21; slot += 1) {
    if (slot % 3 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (prewarmedFirstScreen !== firstScreen || !isCurrent()) return;
    }
    dayPages.push({
      slot,
      ...buildScheduleDateView(
        firstScreen.timetable,
        firstScreen.schedule.plans,
        shiftScheduleDate(firstDate, slot),
        now,
      ),
    });
  }
  firstScreen.pager = assembleSchedulePager(
    dayPages,
    firstScreen.timetable,
    firstScreen.schedule.plans,
    date,
    now,
  );
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
