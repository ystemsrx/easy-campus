import type { AcademicSemesterOption, TimetableData } from "../types/api";
import {
  buildTimetableWeekDateCache,
  type TimetableWeekDateCache,
} from "../data/timetable";
import type { CacheMetadata } from "./cache-policy";

const PREFIX = "easy-swu:timetable:";
const SEMESTER_CATALOG_PREFIX = "easy-swu:timetable-semesters:";

export interface TimetableSnapshot extends CacheMetadata {
  data: TimetableData;
  weekDates: TimetableWeekDateCache[];
}

function storageKey(account: string, semesterId?: string): string {
  return `${PREFIX}${encodeURIComponent(account.trim())}:${encodeURIComponent(semesterId || "default")}`;
}

function semesterCatalogKey(account: string): string {
  return `${SEMESTER_CATALOG_PREFIX}${encodeURIComponent(account.trim())}`;
}

function isSemester(value: unknown): value is AcademicSemesterOption {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AcademicSemesterOption>;
  return (
    typeof candidate.id === "string" &&
    Number.isInteger(candidate.academicYear) &&
    [1, 2, 3].includes(Number(candidate.term)) &&
    typeof candidate.label === "string"
  );
}

function normalizedSemesters(
  values: readonly unknown[],
): AcademicSemesterOption[] {
  return [
    ...new Map(
      values.filter(isSemester).map((semester) => [semester.id, semester]),
    ).values(),
  ].sort(
    (left, right) =>
      right.academicYear - left.academicYear || right.term - left.term,
  );
}

export function loadTimetableSemesterCatalog(
  account: string,
): AcademicSemesterOption[] {
  if (!account.trim()) return [];
  const value = wx.getStorageSync(semesterCatalogKey(account)) as unknown;
  return normalizedSemesters(Array.isArray(value) ? value : []);
}

function mergeTimetableSemesterCatalog(
  account: string,
  data: TimetableData,
): TimetableData {
  const semesters = normalizedSemesters([
    ...loadTimetableSemesterCatalog(account),
    data.semester,
    ...(Array.isArray(data.semesters) ? data.semesters : []),
  ]);
  try {
    wx.setStorageSync(semesterCatalogKey(account), semesters);
  } catch {
    // 学期目录仍会随课表快照保存，不阻断课表首屏。
  }
  return { ...data, semesters };
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

function isWeekDateCache(value: unknown): value is TimetableWeekDateCache[] {
  return (
    Array.isArray(value) &&
    value.every(
      (week) =>
        week !== null &&
        typeof week === "object" &&
        Number.isInteger((week as TimetableWeekDateCache).weekNumber) &&
        (week as TimetableWeekDateCache).weekNumber > 0 &&
        Array.isArray((week as TimetableWeekDateCache).dates) &&
        (week as TimetableWeekDateCache).dates.every(
          (date) => typeof date === "string",
        ),
    )
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
  const cachedWeekDates = value.weekDates;
  const hasCachedWeekDates = isWeekDateCache(cachedWeekDates);
  const data = mergeTimetableSemesterCatalog(account, value.data);
  const snapshot: TimetableSnapshot = {
    data,
    weekDates: hasCachedWeekDates
      ? cachedWeekDates
      : buildTimetableWeekDateCache(data),
    serverFetchedAt: String(value.serverFetchedAt || ""),
    localStoredAt: Number(value.localStoredAt) || legacyUpdatedAt || 0,
  };
  if (
    !hasCachedWeekDates ||
    data.semesters.length !== value.data.semesters?.length
  ) {
    try {
      wx.setStorageSync(storageKey(account, semesterId), snapshot);
    } catch {
      // 旧快照迁移失败时仍可使用内存中生成的周次日期。
    }
  }
  return snapshot;
}

export function saveTimetableSnapshot(
  account: string,
  data: TimetableData,
  options: { semesterId?: string; serverFetchedAt?: string } = {},
): TimetableSnapshot | null {
  if (!account.trim()) return null;
  const cachedData = mergeTimetableSemesterCatalog(account, data);
  const snapshot: TimetableSnapshot = {
    data: cachedData,
    weekDates: buildTimetableWeekDateCache(cachedData),
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
