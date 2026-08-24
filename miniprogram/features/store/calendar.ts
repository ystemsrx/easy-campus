import type { CalendarData } from "../../types/api";

const CACHE_KEY = "easy-swu:calendar-image:latest";
const LEGACY_CACHE_KEY = /^easy-swu:calendar-image:\d+:\d+$/;

interface CalendarImageCache {
  schemaVersion: 1;
  startYear: number;
  calendarVersion: string;
  filePath: string;
}

let legacyCleanup: Promise<void> | undefined;

function calendarSignature(calendar: CalendarData): string {
  return (
    calendar.version ||
    [
      calendar.startYear,
      calendar.publishedAt || "",
      calendar.size,
      calendar.sourcePageUrl,
    ].join(":")
  );
}

function isLatestCalendar(calendar: CalendarData): boolean {
  const availableYears = [
    calendar.startYear,
    ...(calendar.availableAcademicYears || []),
    ...(calendar.availableCalendars || []).map((item) => item.startYear),
  ].filter((year) => Number.isInteger(year) && year > 0);
  return calendar.startYear === Math.max(...availableYears);
}

function readCache(): CalendarImageCache | null {
  const value = wx.getStorageSync(CACHE_KEY) as
    | Partial<CalendarImageCache>
    | undefined;
  if (
    value?.schemaVersion !== 1 ||
    !Number.isInteger(value.startYear) ||
    typeof value.calendarVersion !== "string" ||
    !value.calendarVersion ||
    typeof value.filePath !== "string" ||
    !value.filePath
  ) {
    return null;
  }
  return value as CalendarImageCache;
}

function accessFile(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    wx.getFileSystemManager().access({
      path,
      success: () => resolve(true),
      fail: () => resolve(false),
    });
  });
}

function removeSavedFile(filePath: string): Promise<void> {
  return new Promise((resolve) => {
    wx.getFileSystemManager().removeSavedFile({
      filePath,
      complete: () => resolve(),
    });
  });
}

function persistFile(tempFilePath: string): Promise<string> {
  return new Promise((resolve) => {
    wx.getFileSystemManager().saveFile({
      tempFilePath,
      success: (result: WechatMiniprogram.SaveFileSuccessCallbackResult) =>
        resolve(result.savedFilePath),
      fail: () => resolve(tempFilePath),
    });
  });
}

async function cleanupLegacyCaches(): Promise<void> {
  const keys = wx.getStorageInfoSync().keys.filter((key) =>
    LEGACY_CACHE_KEY.test(key),
  );
  await Promise.all(
    keys.map(async (key) => {
      const filePath = wx.getStorageSync(key);
      wx.removeStorageSync(key);
      if (typeof filePath === "string" && filePath) {
        await removeSavedFile(filePath);
      }
    }),
  );
}

function ensureLegacyCachesRemoved(): Promise<void> {
  if (!legacyCleanup) {
    legacyCleanup = cleanupLegacyCaches();
  }
  return legacyCleanup;
}

async function discardCache(cache: CalendarImageCache | null): Promise<void> {
  wx.removeStorageSync(CACHE_KEY);
  if (cache?.filePath) {
    await removeSavedFile(cache.filePath);
  }
}

export async function getCachedCalendarImage(
  calendar: CalendarData,
  download: () => Promise<string>,
  forceDownload = false,
): Promise<string> {
  await ensureLegacyCachesRemoved();

  if (!isLatestCalendar(calendar)) {
    return download();
  }

  const signature = calendarSignature(calendar);
  const cached = readCache();
  if (
    !forceDownload &&
    cached?.startYear === calendar.startYear &&
    cached.calendarVersion === signature &&
    (await accessFile(cached.filePath))
  ) {
    return cached.filePath;
  }

  const tempFilePath = await download();
  await discardCache(cached);
  const filePath = await persistFile(tempFilePath);
  if (filePath !== tempFilePath) {
    wx.setStorageSync(CACHE_KEY, {
      schemaVersion: 1,
      startYear: calendar.startYear,
      calendarVersion: signature,
      filePath,
    } satisfies CalendarImageCache);
  }
  return filePath;
}
