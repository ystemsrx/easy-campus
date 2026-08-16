import type { LocalScheduleData, LocalSchedulePlan } from "../types/api";

const PREFIX = "easy-swu:schedule:";
const LEGACY_KEY = "easy-swu:schedule-plans";

function storageKey(account: string): string {
  return `${PREFIX}${encodeURIComponent(account.trim())}`;
}

function validPlans(value: unknown): value is LocalSchedulePlan[] {
  return Array.isArray(value);
}

export function loadScheduleData(account: string): LocalScheduleData {
  if (!account.trim()) return { plans: [], clientUpdatedAt: null };
  const stored = wx.getStorageSync(storageKey(account)) as
    Partial<LocalScheduleData> | undefined;
  if (stored && validPlans(stored.plans)) {
    return {
      plans: stored.plans,
      clientUpdatedAt:
        typeof stored.clientUpdatedAt === "string"
          ? stored.clientUpdatedAt
          : null,
    };
  }
  const legacy = wx.getStorageSync(LEGACY_KEY) as unknown;
  if (validPlans(legacy)) {
    const migrated = saveScheduleData(account, legacy);
    wx.removeStorageSync(LEGACY_KEY);
    return migrated;
  }
  return { plans: [], clientUpdatedAt: null };
}

export function saveScheduleData(
  account: string,
  plans: LocalSchedulePlan[],
): LocalScheduleData {
  const data: LocalScheduleData = {
    plans,
    clientUpdatedAt: new Date().toISOString(),
  };
  if (!account.trim()) return data;
  try {
    wx.setStorageSync(storageKey(account), data);
  } catch {
    // 日程仍保留在当前页面内存中，下一次修改会再次尝试写入。
  }
  return data;
}

export function storeScheduleData(
  account: string,
  data: LocalScheduleData,
): LocalScheduleData {
  const normalized: LocalScheduleData = {
    plans: validPlans(data.plans) ? data.plans : [],
    clientUpdatedAt: data.clientUpdatedAt || new Date().toISOString(),
  };
  if (account.trim()) {
    try {
      wx.setStorageSync(storageKey(account), normalized);
    } catch {
      // 服务端恢复只是辅助层，写入失败不阻塞页面。
    }
  }
  return normalized;
}
