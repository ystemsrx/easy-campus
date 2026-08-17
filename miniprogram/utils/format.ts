import type { GradeValue, MessageSchedule } from "../types/api";
import { formatMessageWeekday } from "./date";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatCredits(value: number | null): string {
  return value === null
    ? "—"
    : Number.isInteger(value)
      ? `${value}`
      : value.toFixed(1);
}

export function formatScore(value: GradeValue): string {
  if (value === null || value === "") {
    return "—";
  }
  return String(value);
}

export function scoreTone(
  value: GradeValue,
): "great" | "good" | "warning" | "text" | "muted" {
  if (typeof value !== "number") {
    return value === null ? "muted" : "text";
  }
  if (value >= 90) {
    return "great";
  }
  if (value >= 75) {
    return "good";
  }
  if (value >= 60) {
    return "warning";
  }
  return "text";
}

export function formatSchedule(schedule: MessageSchedule): string {
  const date = formatScheduleDate(schedule);
  const period =
    schedule.periodStart === schedule.periodEnd
      ? `第${schedule.periodStart}节`
      : `${schedule.periodStart}–${schedule.periodEnd}节`;
  return `${date} ${period}`;
}

export function formatScheduleDate(schedule: MessageSchedule): string {
  const weeks = normalizeScheduleWeeks(schedule);
  const week = `第${compactWeekRanges(weeks)}周`;
  return `${week} ${formatMessageWeekday(schedule.weekday)}`;
}

function normalizeScheduleWeeks(schedule: MessageSchedule): number[] {
  const explicit = (schedule.weeks || []).filter(
    (week) => Number.isInteger(week) && week > 0,
  );
  if (explicit.length) {
    return [...new Set(explicit)].sort((left, right) => left - right);
  }
  const start = Math.min(schedule.weekStart, schedule.weekEnd);
  const end = Math.max(schedule.weekStart, schedule.weekEnd);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function compactWeekRanges(weeks: number[]): string {
  if (!weeks.length) return "—";
  const parts: string[] = [];
  let rangeStart = weeks[0];
  let previous = weeks[0];
  for (let index = 1; index <= weeks.length; index += 1) {
    const current = weeks[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    parts.push(
      rangeStart === previous ? `${rangeStart}` : `${rangeStart}–${previous}`,
    );
    rangeStart = current;
    previous = current;
  }
  return parts.join("、");
}
