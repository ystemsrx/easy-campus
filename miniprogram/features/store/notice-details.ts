import type { NoticeDetail, QueryMeta } from "../../types/api";
import { DAY_MS, timestampValue } from "../../store/cache-policy";

const STORAGE_KEY = "easy-swu:notice-details:v1";
const SCHEMA_VERSION = 1;
const MAX_DETAILS = 15;

export interface NoticeDetailSnapshot {
  account: string;
  id: string;
  detail: NoticeDetail;
  serverFetchedAt: string;
  checkedAt: number;
}

function isSnapshot(value: unknown): value is NoticeDetailSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<NoticeDetailSnapshot>;
  return (
    typeof item.account === "string" &&
    typeof item.id === "string" &&
    typeof item.serverFetchedAt === "string" &&
    typeof item.checkedAt === "number" &&
    Number.isFinite(item.checkedAt) &&
    typeof item.detail?.title === "string" &&
    typeof item.detail.contentHtml === "string" &&
    item.detail.contentHtml.length > 0
  );
}

function readSnapshots(): NoticeDetailSnapshot[] {
  try {
    const stored = wx.getStorageSync(STORAGE_KEY) as unknown;
    if (!stored || typeof stored !== "object") return [];
    const cache = stored as { schemaVersion?: number; items?: unknown };
    if (cache.schemaVersion !== SCHEMA_VERSION || !Array.isArray(cache.items))
      return [];
    return cache.items.filter(isSnapshot).slice(0, MAX_DETAILS);
  } catch {
    return [];
  }
}

function writeSnapshots(items: NoticeDetailSnapshot[]): void {
  for (let count = Math.min(items.length, MAX_DETAILS); count > 0; count -= 1) {
    try {
      wx.setStorageSync(STORAGE_KEY, {
        schemaVersion: SCHEMA_VERSION,
        items: items.slice(0, count),
      });
      return;
    } catch {
      // A large article may exceed device storage; retain fewer older entries.
    }
  }
}

export function loadNoticeDetailSnapshot(
  account: string,
  id: string,
): NoticeDetailSnapshot | null {
  if (!account.trim() || !id.trim()) return null;
  const items = readSnapshots();
  const index = items.findIndex(
    (item) => item.account === account && item.id === id,
  );
  if (index < 0) return null;
  const [snapshot] = items.splice(index, 1);
  if (index > 0) writeSnapshots([snapshot, ...items]);
  return snapshot;
}

export function isNoticeDetailDue(
  snapshot: NoticeDetailSnapshot | null,
  now = Date.now(),
): boolean {
  return (
    !snapshot ||
    !snapshot.checkedAt ||
    now < snapshot.checkedAt ||
    now - snapshot.checkedAt >= DAY_MS
  );
}

export function saveNoticeDetailSnapshot(
  account: string,
  id: string,
  detail: NoticeDetail,
  meta: Pick<QueryMeta, "fetchedAt" | "refreshing" | "stale">,
  now = Date.now(),
): NoticeDetailSnapshot | null {
  if (!account.trim() || !id.trim() || !detail.contentHtml) return null;
  const items = readSnapshots();
  const current = items.find(
    (item) => item.account === account && item.id === id,
  );
  const incomingFetchedAt = meta.fetchedAt || "";
  if (
    current &&
    timestampValue(current.serverFetchedAt) >
      timestampValue(incomingFetchedAt)
  )
    return current;
  const snapshot: NoticeDetailSnapshot = {
    account,
    id,
    detail,
    serverFetchedAt: incomingFetchedAt,
    checkedAt:
      meta.stale || meta.refreshing ? current?.checkedAt || 0 : now,
  };
  writeSnapshots([
    snapshot,
    ...items.filter((item) => item.account !== account || item.id !== id),
  ]);
  return snapshot;
}

export { MAX_DETAILS as NOTICE_DETAIL_CACHE_LIMIT };
