import type { ElectricityCachedData } from "../types/api";
import type { CacheMetadata } from "./cache-policy";

const PREFIX = "easy-swu:electricity:";

export interface ElectricitySnapshot extends CacheMetadata {
  data: ElectricityCachedData;
}

function storageKey(account: string): string {
  return `${PREFIX}${encodeURIComponent(account.trim())}`;
}

export function loadElectricitySnapshot(
  account: string,
): ElectricitySnapshot | null {
  if (!account.trim()) return null;
  const value = wx.getStorageSync(storageKey(account)) as
    Partial<ElectricitySnapshot> | undefined;
  if (!value || !value.data || typeof value.data !== "object") return null;
  return {
    data: value.data as ElectricityCachedData,
    serverFetchedAt: String(value.serverFetchedAt || ""),
    localStoredAt: Number(value.localStoredAt) || 0,
  };
}

export function saveElectricitySnapshot(
  account: string,
  data: ElectricityCachedData,
  serverFetchedAt = "",
): ElectricitySnapshot | null {
  if (!account.trim()) return null;
  const snapshot: ElectricitySnapshot = {
    data,
    serverFetchedAt,
    localStoredAt: Date.now(),
  };
  try {
    wx.setStorageSync(storageKey(account), snapshot);
  } catch {
    // 本地失败时仍可从服务器恢复绑定和最近一次账单。
  }
  return snapshot;
}
