import type { VisitHistory } from "../../store/visits";
import {
  formatFriendlyDate,
  localDateKey,
  toDateString,
} from "../../utils/date";

const ACTIVE_LEVEL_COUNT = 4; // The fifth color is reserved for days without visits.
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

export interface VisitBrick {
  date: string;
  count: number;
  level: number;
  future: boolean;
  recorded: boolean;
  label: string;
}

function calendarDay(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  // Compare local calendar dates without counting 23/25-hour DST days as fractions.
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function daysSinceRegistration(
  registeredAt: string | null | undefined,
  now = new Date(),
): number | null {
  if (!registeredAt || !Number.isFinite(now.getTime())) return null;
  const firstDay = localDateKey(registeredAt);
  if (!firstDay) return null;
  const days = calendarDay(toDateString(now)) - calendarDay(firstDay) + 1;
  return days > 0 ? days : null;
}

export function buildVisitWall(
  history: VisitHistory,
  now = new Date(),
  weekCount: 8 | 13 = 13,
) {
  const today = toDateString(now);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(
    start.getDate() - ((start.getDay() + 6) % 7) - (weekCount - 1) * 7,
  );
  const weeks: Array<{ key: string; month: string; days: VisitBrick[] }> = [];
  const positiveCounts = new Set<number>();
  let previousMonth = -1;
  for (let week = 0; week < weekCount; week += 1) {
    const monday = new Date(start);
    monday.setDate(start.getDate() + week * 7);
    const month = monday.getMonth();
    const days: VisitBrick[] = [];
    for (let day = 0; day < 7; day += 1) {
      const current = new Date(monday);
      current.setDate(monday.getDate() + day);
      const date = toDateString(current);
      const future = date > today;
      const recorded = Boolean(
        history.startedOn && date >= history.startedOn && !future,
      );
      const count = recorded ? history.days[date] || 0 : 0;
      if (count > 0) positiveCounts.add(count);
      days.push({
        date,
        count,
        level: 0,
        future,
        recorded,
        label: `${formatFriendlyDate(date)}，${recorded ? `上线 ${count} 次` : "未记录"}`,
      });
    }
    weeks.push({
      key: toDateString(monday),
      month: month !== previousMonth ? `${month + 1}月` : "",
      days,
    });
    previousMonth = month;
  }
  const counts = Array.from(positiveCounts).sort((a, b) => a - b);
  const levels = new Map(
    counts.map((count, index) => [
      count,
      counts.length <= ACTIVE_LEVEL_COUNT
        ? ACTIVE_LEVEL_COUNT - counts.length + index + 1
        : Math.ceil(((index + 1) * ACTIVE_LEVEL_COUNT) / counts.length),
    ]),
  );
  for (const week of weeks) {
    for (const day of week.days) day.level = levels.get(day.count) || 0;
  }
  return {
    today,
    months: weeks.map(({ key, month }) => ({ key, label: month })),
    rows: WEEKDAYS.map((label, index) => ({
      key: index,
      label,
      days: weeks.map((week) => week.days[index]),
    })),
  };
}
