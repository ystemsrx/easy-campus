import type { TimetableData } from "../types/api";

const PREFIX = "easy-swu:timetable:";

export interface TimetableSnapshot {
  data: TimetableData;
  updatedAt: number;
}

function storageKey(account: string, semesterId?: string): string {
  return `${PREFIX}${encodeURIComponent(account.trim())}:${encodeURIComponent(semesterId || "default")}`;
}

function isTimetable(value: unknown): value is TimetableData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TimetableData>;
  return (
    typeof candidate.semester?.id === "string" &&
    Array.isArray(candidate.periods) &&
    Array.isArray(candidate.courses)
  );
}

export function loadTimetableSnapshot(
  account: string,
  semesterId?: string,
): TimetableSnapshot | null {
  if (!account.trim()) return null;
  const value = wx.getStorageSync(storageKey(account, semesterId)) as
    Partial<TimetableSnapshot> | undefined;
  if (!value || !isTimetable(value.data)) return null;
  return { data: value.data, updatedAt: Number(value.updatedAt) || 0 };
}

export function saveTimetableSnapshot(
  account: string,
  data: TimetableData,
  semesterId?: string,
): void {
  if (!account.trim()) return;
  try {
    wx.setStorageSync(storageKey(account, semesterId), {
      data,
      updatedAt: Date.now(),
    } satisfies TimetableSnapshot);
  } catch {
    // 本地快照只是首屏加速层，服务端仍保存完整的用户课表。
  }
}
