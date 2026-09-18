import { apiRequest } from "./request";
import { getSession } from "../store/session";
import { isDemoSession } from "../demo/identity";

export interface SessionDeviceInfo {
  brand: string | null;
  model: string | null;
  system: string | null;
  cpuType: string | null;
  memorySize: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  pixelRatio: number | null;
  safeArea: { top: number; right: number; bottom: number; left: number } | null;
  wechatVersion: string | null;
  wechatLanguage: string | null;
}

function value(input: unknown): string | null {
  if (typeof input === "string") return input.trim() || null;
  if (typeof input === "number" && Number.isFinite(input) && input > 0) {
    return String(input);
  }
  return null;
}

export function collectSessionDeviceInfo(): SessionDeviceInfo {
  let device: Partial<WechatMiniprogram.DeviceInfo> = {};
  let window: Partial<WechatMiniprogram.WindowInfo> = {};
  let app: Partial<WechatMiniprogram.AppBaseInfo> = {};
  try {
    device = wx.getDeviceInfo() || {};
  } catch {
    /* Older base library. */
  }
  try {
    window = wx.getWindowInfo() || {};
  } catch {
    /* Older base library. */
  }
  try {
    app = wx.getAppBaseInfo() || {};
  } catch {
    /* Older base library. */
  }
  const ratio = Number(window.pixelRatio);
  const width = Number(window.screenWidth);
  const height = Number(window.screenHeight);
  const safe = window.safeArea;
  return {
    brand: value(device.brand),
    model: value(device.model),
    system: value(device.system),
    cpuType: value(device.cpuType),
    memorySize: value(device.memorySize),
    screenWidth: width > 0 && ratio > 0 ? Math.round(width * ratio) : null,
    screenHeight: height > 0 && ratio > 0 ? Math.round(height * ratio) : null,
    pixelRatio: ratio > 0 ? ratio : null,
    safeArea:
      safe &&
      [safe.top, safe.right, safe.bottom, safe.left].every(Number.isFinite)
        ? {
            top: safe.top,
            right: safe.right,
            bottom: safe.bottom,
            left: safe.left,
          }
        : null,
    wechatVersion: value(app.version),
    wechatLanguage: value(app.language),
  };
}

let syncedToken: string | null = null;

export function syncSessionDeviceInfo(): void {
  const session = getSession();
  if (isDemoSession(session)) return;
  const token = session?.token;
  if (!token || token === syncedToken) return;
  syncedToken = token;
  void apiRequest<{ updated: true }>("/auth/session/device-info", {
    method: "POST",
    data: collectSessionDeviceInfo(),
    allowInvalidCredential: true,
    retry: false,
  }).catch(() => {
    if (syncedToken === token) syncedToken = null;
  });
}
