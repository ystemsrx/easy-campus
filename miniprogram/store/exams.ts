import type { ExamsData } from "../types/api";
import type { CacheMetadata } from "./cache-policy";

const PREFIX = "easy-swu:exams:";
const SCHEMA_VERSION = 3;

export interface ExamsSnapshot extends CacheMetadata {
  schemaVersion: typeof SCHEMA_VERSION;
  data: ExamsData;
  refreshedForSignInAt: number;
}

function storageKey(account: string, semesterId = "default"): string {
  return `${PREFIX}${encodeURIComponent(account.trim())}:${encodeURIComponent(semesterId || "default")}`;
}

function isExamsData(value: unknown): value is ExamsData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExamsData>;
  return (
    Array.isArray(candidate.items) &&
    Array.isArray(candidate.semesters) &&
    Boolean(candidate.summary) &&
    Boolean(candidate.pagination)
  );
}

export function loadExamsSnapshot(
  account: string,
  semesterId = "default",
): ExamsSnapshot | null {
  if (!account.trim()) return null;
  const value = wx.getStorageSync(storageKey(account, semesterId)) as
    Partial<ExamsSnapshot> | undefined;
  if (
    !value ||
    value.schemaVersion !== SCHEMA_VERSION ||
    !isExamsData(value.data)
  ) {
    return null;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    data: value.data,
    serverFetchedAt: String(value.serverFetchedAt || ""),
    localStoredAt: Number(value.localStoredAt) || 0,
    refreshedForSignInAt: Number(value.refreshedForSignInAt) || 0,
  };
}

export function saveExamsSnapshot(
  account: string,
  data: ExamsData,
  options: {
    semesterId?: string;
    serverFetchedAt?: string;
    refreshedForSignInAt?: number;
  } = {},
): ExamsSnapshot | null {
  if (!account.trim()) return null;
  const snapshot: ExamsSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    data,
    serverFetchedAt: options.serverFetchedAt || "",
    localStoredAt: Date.now(),
    refreshedForSignInAt: options.refreshedForSignInAt || 0,
  };
  try {
    const semesterId = options.semesterId || "default";
    wx.setStorageSync(storageKey(account, semesterId), snapshot);
    if (semesterId === "default" && data.semester?.id) {
      wx.setStorageSync(storageKey(account, data.semester.id), snapshot);
    }
  } catch {
    // 服务端快照仍可作为恢复来源。
  }
  return snapshot;
}
