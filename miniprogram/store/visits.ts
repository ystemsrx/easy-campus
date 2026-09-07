import { toDateString } from "../utils/date";

const VISITS_KEY_PREFIX = "easy-swu:visits:v1:";
const RETAINED_DAYS = 400;
const memory = new Map<string, VisitHistory>();

export interface VisitHistory {
  version: 1;
  startedOn: string;
  days: Record<string, number>;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  return toDateString(new Date(year, month - 1, day)) === value;
}

export function loadVisitHistory(account: string): VisitHistory {
  const empty: VisitHistory = { version: 1, startedOn: "", days: {} };
  if (!account) return empty;
  const remembered = memory.get(account);
  if (remembered) return { ...remembered, days: { ...remembered.days } };
  try {
    const stored = wx.getStorageSync(
      `${VISITS_KEY_PREFIX}${encodeURIComponent(account)}`,
    ) as Partial<VisitHistory> | undefined;
    if (
      stored?.version !== 1 ||
      !validDate(stored.startedOn) ||
      !stored.days ||
      typeof stored.days !== "object" ||
      Array.isArray(stored.days)
    )
      return empty;
    const days: Record<string, number> = {};
    for (const [date, count] of Object.entries(stored.days)) {
      if (
        validDate(date) &&
        date >= stored.startedOn &&
        Number.isSafeInteger(count) &&
        count > 0
      )
        days[date] = count;
    }
    return { version: 1, startedOn: stored.startedOn, days };
  } catch {
    return empty;
  }
}

/** One visit per foreground entry, grouped by the device's local calendar day. */
export function recordVisit(account: string, now = new Date()): void {
  if (!account || !Number.isFinite(now.getTime())) return;
  const history = loadVisitHistory(account);
  const date = toDateString(now);
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  cutoff.setDate(cutoff.getDate() - RETAINED_DAYS + 1);
  const oldestDate = toDateString(cutoff);
  const days: Record<string, number> = {};
  for (const [key, count] of Object.entries(history.days)) {
    if (key >= oldestDate) days[key] = count;
  }
  days[date] = Math.min((days[date] || 0) + 1, Number.MAX_SAFE_INTEGER);
  const next: VisitHistory = {
    version: 1,
    startedOn:
      history.startedOn && history.startedOn < date ? history.startedOn : date,
    days,
  };
  memory.set(account, next);
  try {
    wx.setStorageSync(
      `${VISITS_KEY_PREFIX}${encodeURIComponent(account)}`,
      next,
    );
  } catch {
    // Storage failures must not interrupt app launch; retain this run in memory.
  }
}
