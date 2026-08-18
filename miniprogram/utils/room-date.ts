const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const LATE_DAY_CUTOFF_HOUR = 22;
const RESULT_WEEKDAYS = [
  "周日",
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
];

function addCalendarDays(value: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function beijingHour(now: Date): number {
  return new Date(now.getTime() + BEIJING_OFFSET_MS).getUTCHours();
}

export function resolveInitialRoomDate(
  minDate: string,
  currentDate: string,
  now = new Date(),
): string {
  if (currentDate) return currentDate;
  return beijingHour(now) >= LATE_DAY_CUTOFF_HOUR
    ? addCalendarDays(minDate, 1)
    : minDate;
}

export function formatRoomResultDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const weekday = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).getUTCDay();
  return `${Number(match[2])}-${Number(match[3])} ${RESULT_WEEKDAYS[weekday]}`;
}
