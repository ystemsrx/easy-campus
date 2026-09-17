import type {
  LocalScheduleCourse,
  LocalScheduleData,
  LocalSchedulePlan,
} from "../types/api";

const PREFIX = "easy-swu:schedule:";
const LEGACY_KEY = "easy-swu:schedule-plans";
let scheduleRevision = 0;

export function getScheduleRevision(): number {
  return scheduleRevision;
}

function storageKey(account: string): string {
  return `${PREFIX}${encodeURIComponent(account.trim())}`;
}

function validPlans(value: unknown): value is LocalSchedulePlan[] {
  return Array.isArray(value);
}

export function loadScheduleData(account: string): LocalScheduleData {
  if (!account.trim()) return { plans: [], courses: [], clientUpdatedAt: null };
  const stored = wx.getStorageSync(storageKey(account)) as
    Partial<LocalScheduleData> | undefined;
  if (stored && validPlans(stored.plans)) {
    return {
      plans: stored.plans,
      courses: Array.isArray(stored.courses) ? stored.courses : [],
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
  return { plans: [], courses: [], clientUpdatedAt: null };
}

export function saveScheduleData(
  account: string,
  plans: LocalSchedulePlan[],
  courses: LocalScheduleCourse[] = loadScheduleData(account).courses,
): LocalScheduleData {
  const previous = new Date(
    loadScheduleData(account).clientUpdatedAt || 0,
  ).getTime();
  const data: LocalScheduleData = {
    plans,
    courses,
    clientUpdatedAt: new Date(Math.max(Date.now(), previous + 1)).toISOString(),
  };
  if (!account.trim()) return data;
  try {
    wx.setStorageSync(storageKey(account), data);
    scheduleRevision += 1;
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
    courses: Array.isArray(data.courses) ? data.courses : [],
    clientUpdatedAt: data.clientUpdatedAt || new Date().toISOString(),
  };
  if (account.trim()) {
    try {
      wx.setStorageSync(storageKey(account), normalized);
      scheduleRevision += 1;
    } catch {
      // 服务端恢复只是辅助层，写入失败不阻塞页面。
    }
  }
  return normalized;
}
