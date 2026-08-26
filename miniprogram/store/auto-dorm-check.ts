import type { AutoDormCheckState, AutoDormCheckStatus } from "../types/api";

const PREFIX = "easy-swu:auto-dorm-check:v1:";
const VALID_STATES = new Set<AutoDormCheckState>([
  "checked_in",
  "pending",
  "unavailable",
  "disabled",
]);

export interface AutoDormCheckSnapshot {
  entryEnabled: boolean;
  checkInStatus: AutoDormCheckState;
  localStoredAt: number;
}

function storageKey(account: string): string {
  return `${PREFIX}${encodeURIComponent(account.trim().toLowerCase())}`;
}

export function loadAutoDormCheckSnapshot(
  account: string,
): AutoDormCheckSnapshot | null {
  if (!account.trim()) return null;
  const value = wx.getStorageSync(storageKey(account)) as
    Partial<AutoDormCheckSnapshot> | undefined;
  if (
    !value ||
    typeof value.entryEnabled !== "boolean" ||
    !VALID_STATES.has(value.checkInStatus as AutoDormCheckState)
  ) {
    return null;
  }
  return {
    entryEnabled: value.entryEnabled,
    checkInStatus: value.checkInStatus as AutoDormCheckState,
    localStoredAt: Number(value.localStoredAt) || 0,
  };
}

export function saveAutoDormCheckSnapshot(
  account: string,
  status: Pick<AutoDormCheckStatus, "entryEnabled" | "checkInStatus">,
): AutoDormCheckSnapshot | null {
  if (!account.trim()) return null;
  const snapshot: AutoDormCheckSnapshot = {
    entryEnabled: status.entryEnabled,
    checkInStatus: status.checkInStatus,
    localStoredAt: Date.now(),
  };
  try {
    wx.setStorageSync(storageKey(account), snapshot);
  } catch {
    // 写入失败时，本次应用生命周期仍可复用主页发出的请求。
  }
  return snapshot;
}
