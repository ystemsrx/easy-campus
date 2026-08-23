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

export type ScoreTone =
  "great" | "good" | "average" | "warning" | "danger" | "muted";

const LEVEL_GRADE_SCORES = new Map<string, number>([
  ["A", 95],
  ["优秀", 95],
  ["优", 95],
  ["B", 85],
  ["良好", 85],
  ["良", 85],
  ["C", 75],
  ["中等", 75],
  ["中", 75],
  ["D", 65],
  ["及格", 65],
  ["E", 55],
  ["不及格", 55],
]);

function comparableScore(value: GradeValue): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  }
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!normalized) return null;
  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const numeric = Number(normalized);
    return numeric >= 0 && numeric <= 100 ? numeric : null;
  }
  return LEVEL_GRADE_SCORES.get(normalized) ?? null;
}

export function scoreTone(value: GradeValue, forceDanger = false): ScoreTone {
  if (forceDanger) return "danger";
  if (value === null || value === "") return "muted";
  const score = comparableScore(value);
  if (score === null) return "danger";
  if (score >= 90) {
    return "great";
  }
  if (score >= 80) {
    return "good";
  }
  if (score >= 70) {
    return "average";
  }
  if (score >= 60) {
    return "warning";
  }
  return "danger";
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
