import { getApiUrl } from "../config/index";
import { apiRequest, createAuthenticatedRequestHeaders } from "./request";
import { captureSessionLease, isSessionLeaseCurrent } from "../store/session";
import { clearLegacyCustomBackground, imageEdgeColors, legacyCustomBackground, loadCustomBackground, saveCustomBackground } from "../data/timetable-custom";

const PATH = "/teaching/timetable/background";
let generation = 0;
let syncFlight: Promise<string | null> | null = null;
let syncUserId: string | number | null = null;

export async function uploadTimetableBackground(path: string): Promise<string> {
  const requestGeneration = ++generation;
  const lease = captureSessionLease();
  if (!lease) throw new Error("请先登录");
  const data = await new Promise<ArrayBuffer>((resolve, reject) => {
    wx.getFileSystemManager().readFile({ filePath: path, success: ({ data }) => resolve(data as ArrayBuffer), fail: reject });
  });
  if (data.byteLength > 8 * 1024 * 1024) throw new Error("请选择不超过 8 MiB 的图片");
  const result = await apiRequest<{ version: string }>(PATH, {
    method: "PUT", data, headers: { "Content-Type": "application/octet-stream" }, retry: false,
  });
  if (!isSessionLeaseCurrent(lease)) throw new Error("登录账号已经切换");
  return downloadTimetableBackground(result.version, requestGeneration);
}

export function syncTimetableBackground(): Promise<string | null> {
  const userId = captureSessionLease()?.userId || null;
  if (syncFlight && syncUserId === userId) return syncFlight;
  const pending = syncBackground();
  syncFlight = pending;
  syncUserId = userId;
  void pending.finally(() => { if (syncFlight === pending) syncFlight = null; }).catch(() => {});
  return pending;
}

export async function ensureTimetableBackgroundColor(): Promise<void> {
  const lease = captureSessionLease();
  if (!lease) return;
  const cached = loadCustomBackground(lease.userId);
  if (!cached || cached.dominantColor) return;
  const { dominantColor } = await imageEdgeColors(cached.filePath);
  const current = loadCustomBackground(lease.userId);
  if (
    isSessionLeaseCurrent(lease) &&
    current?.version === cached.version &&
    current.filePath === cached.filePath
  ) {
    saveCustomBackground(lease.userId, { ...current, dominantColor });
  }
}

async function syncBackground(): Promise<string | null> {
  const requestGeneration = generation;
  const lease = captureSessionLease();
  if (!lease) return null;
  const { version } = await apiRequest<{ version: string | null }>(PATH);
  if (!version || !isSessionLeaseCurrent(lease)) return null;
  const cached = loadCustomBackground(lease.userId);
  if (cached?.version === version && await fileExists(cached.filePath)) {
    if (!cached.dominantColor) {
      try { await ensureTimetableBackgroundColor(); } catch { /* Keep cached edges available offline. */ }
    }
    return generation === requestGeneration && isSessionLeaseCurrent(lease) ? cached.filePath : null;
  }
  const legacy = legacyCustomBackground(lease.userId);
  if (legacy?.version === version && await fileExists(legacy.filePath)) {
    const image = await imageEdgeColors(legacy.filePath);
    if (generation !== requestGeneration || !isSessionLeaseCurrent(lease)) return null;
    saveCustomBackground(lease.userId, { version, filePath: legacy.filePath, ...image });
    clearLegacyCustomBackground(lease.userId);
    return legacy.filePath;
  }
  return downloadTimetableBackground(version, requestGeneration);
}

function fileExists(path: string): Promise<boolean> {
  return new Promise((resolve) => wx.getFileSystemManager().access({ path, success: () => resolve(true), fail: () => resolve(false) }));
}

async function downloadTimetableBackground(version: string, requestGeneration: number): Promise<string> {
  const lease = captureSessionLease();
  if (!lease) throw new Error("请先登录");
  const path = `${PATH}/image`;
  const headers = await createAuthenticatedRequestHeaders(path, lease);
  const tempFilePath = await new Promise<string>((resolve, reject) => {
    wx.downloadFile({ url: getApiUrl(path), header: headers, timeout: 60000,
      success: (result) => result.statusCode === 200 ? resolve(result.tempFilePath) : reject(new Error("背景图片下载失败")),
      fail: reject,
    });
  });
  if (!isSessionLeaseCurrent(lease) || generation !== requestGeneration) throw new Error("背景已更新");
  const image = await imageEdgeColors(tempFilePath);
  const filePath = await new Promise<string>((resolve, reject) => {
    wx.getFileSystemManager().saveFile({ tempFilePath, success: (result) => resolve(result.savedFilePath), fail: reject });
  });
  if (!isSessionLeaseCurrent(lease) || generation !== requestGeneration) {
    wx.getFileSystemManager().removeSavedFile({ filePath });
    throw new Error("登录账号已经切换");
  }
  const previous = loadCustomBackground(lease.userId);
  const legacy = legacyCustomBackground(lease.userId);
  saveCustomBackground(lease.userId, { version, filePath, ...image });
  clearLegacyCustomBackground(lease.userId);
  if (previous?.filePath && previous.filePath !== filePath) {
    wx.getFileSystemManager().removeSavedFile({ filePath: previous.filePath });
  }
  if (legacy?.filePath && legacy.filePath !== filePath && legacy.filePath !== previous?.filePath) {
    wx.getFileSystemManager().removeSavedFile({ filePath: legacy.filePath });
  }
  return filePath;
}
