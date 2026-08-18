import type { Exam } from "../types/api";
import { localDateKey, today } from "./date";

export type ExamCountdownTone =
  "current" | "urgent" | "soon" | "week" | "later" | "past" | "pending";

export interface ExamCountdown {
  days: number | null;
  label: string;
  tone: ExamCountdownTone;
}

export interface ExamProgressSummary {
  total: number;
  pending: number;
  past: number;
}

export type ExamBatchLabel = "正常考试" | "重修" | "补/缓考";

const DAY_MS = 24 * 60 * 60 * 1000;

function dateAtLocalMidnight(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ).getTime();
}

export function examDateKey(exam: Exam): string {
  return exam.time.startAt ? localDateKey(exam.time.startAt) : exam.time.date;
}

export function examTimestamp(exam: Exam): number {
  if (exam.time.startAt) {
    const value = new Date(exam.time.startAt).getTime();
    if (Number.isFinite(value)) return value;
  }
  return dateAtLocalMidnight(examDateKey(exam)) ?? Number.MAX_SAFE_INTEGER;
}

export function examBatchLabel(exam: Exam): ExamBatchLabel {
  if (exam.examName.includes("补缓考")) return "补/缓考";
  if (exam.retake === true) return "重修";
  return "正常考试";
}

export function examCountdown(
  exam: Exam,
  referenceDate = today(),
): ExamCountdown {
  const target = dateAtLocalMidnight(examDateKey(exam));
  const current = dateAtLocalMidnight(referenceDate);
  if (target === null || current === null) {
    return { days: null, label: "待", tone: "pending" };
  }

  const days = Math.round((target - current) / DAY_MS);
  if (days < 0) return { days, label: "过", tone: "past" };
  if (days === 0) return { days, label: "逢考必过", tone: "current" };
  if (days <= 3) return { days, label: String(days), tone: "urgent" };
  if (days <= 5) return { days, label: String(days), tone: "soon" };
  if (days <= 7) return { days, label: String(days), tone: "week" };
  return { days, label: String(days), tone: "later" };
}

export function summarizeExamProgress(
  exams: Exam[],
  total = exams.length,
  referenceDate = today(),
): ExamProgressSummary {
  const resolvedTotal = Math.max(total, exams.length);
  const past = exams.filter(
    (exam) => examCountdown(exam, referenceDate).tone === "past",
  ).length;
  return {
    total: resolvedTotal,
    pending: Math.max(0, resolvedTotal - past),
    past,
  };
}
