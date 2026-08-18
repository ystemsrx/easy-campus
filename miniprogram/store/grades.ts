import type { GradesData } from "../types/api";
import type { CacheMetadata } from "./cache-policy";

const PREFIX = "easy-swu:grades:";
const SCHEMA_VERSION = 6;

export interface GradesSnapshot extends CacheMetadata {
  schemaVersion: typeof SCHEMA_VERSION;
  data: GradesData;
}

function storageKey(account: string): string {
  return `${PREFIX}${encodeURIComponent(account.trim())}`;
}

function isGradesData(value: unknown): value is GradesData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GradesData>;
  const summary = candidate.summary as Partial<GradesData["summary"]>;
  return (
    Array.isArray(candidate.items) &&
    Array.isArray(candidate.semesters) &&
    Boolean(summary) &&
    typeof summary.courseCount === "number" &&
    typeof summary.totalCredits === "number" &&
    Object.prototype.hasOwnProperty.call(summary, "weightedAverage") &&
    Object.prototype.hasOwnProperty.call(summary, "gradePointAverage") &&
    Boolean(candidate.pagination)
  );
}

export function loadGradesSnapshot(account: string): GradesSnapshot | null {
  if (!account.trim()) return null;
  const value = wx.getStorageSync(storageKey(account)) as
    Partial<GradesSnapshot> | undefined;
  if (
    !value ||
    value.schemaVersion !== SCHEMA_VERSION ||
    !isGradesData(value.data)
  ) {
    return null;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    data: value.data,
    serverFetchedAt: String(value.serverFetchedAt || ""),
    localStoredAt: Number(value.localStoredAt) || 0,
  };
}

export function saveGradesSnapshot(
  account: string,
  data: GradesData,
  serverFetchedAt = "",
): GradesSnapshot | null {
  if (!account.trim()) return null;
  const snapshot: GradesSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    data,
    serverFetchedAt,
    localStoredAt: Date.now(),
  };
  try {
    wx.setStorageSync(storageKey(account), snapshot);
  } catch {
    // 服务端仍保存完整快照，本地写入失败不会影响后续查询。
  }
  return snapshot;
}
