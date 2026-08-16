import type { TimetableData } from "../types/api";
import type { CacheMetadata } from "./cache-policy";

const PREFIX = "easy-swu:timetable:";

export interface TimetableSnapshot extends CacheMetadata {
  data: TimetableData;
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
  const legacyUpdatedAt = Number(
    (value as Partial<TimetableSnapshot> & { updatedAt?: number }).updatedAt,
  );
  return {
    data: value.data,
    serverFetchedAt: String(value.serverFetchedAt || ""),
    localStoredAt: Number(value.localStoredAt) || legacyUpdatedAt || 0,
  };
}

export function saveTimetableSnapshot(
  account: string,
  data: TimetableData,
  options: { semesterId?: string; serverFetchedAt?: string } = {},
): TimetableSnapshot | null {
  if (!account.trim()) return null;
  const snapshot: TimetableSnapshot = {
    data,
    serverFetchedAt: options.serverFetchedAt || "",
    localStoredAt: Date.now(),
  };
  try {
    wx.setStorageSync(storageKey(account, options.semesterId), snapshot);
  } catch {
    // 本地快照只是首屏加速层，服务端仍保存完整的用户课表。
  }
  return snapshot;
}
