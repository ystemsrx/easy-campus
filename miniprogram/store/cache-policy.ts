export const DAY_MS = 24 * 60 * 60 * 1000;
export const FIFTEEN_DAYS_MS = 15 * DAY_MS;

const automaticRefreshClaims = new Set<string>();

export interface CacheMetadata {
  serverFetchedAt: string;
  localStoredAt: number;
}

export interface ServerSnapshotMetadata {
  cached: boolean;
  fetchedAt?: string;
  stale?: boolean;
}

export function timestampValue(value: string | number | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function shouldUseServerSnapshot(
  local: CacheMetadata | null,
  serverFetchedAt?: string,
): boolean {
  if (!local) return true;
  const incoming = timestampValue(serverFetchedAt);
  const current = timestampValue(local.serverFetchedAt);
  if (!incoming) return !current;
  return incoming > current;
}

/** 只有真正完成上游访问的刷新，才能被记为一次成功刷新。 */
export function isUpstreamRefreshResult(
  meta: Pick<ServerSnapshotMetadata, "cached" | "stale">,
): boolean {
  return meta.cached === false && meta.stale !== true;
}

/**
 * 刷新被限流降级为缓存、或上游失败后返回旧快照时，不覆盖本地数据。
 * 普通读取仍可按服务端抓取时间接收另一设备已经更新的持久快照。
 */
export function shouldStoreServerSnapshot(
  local: CacheMetadata | null,
  meta: ServerSnapshotMetadata,
  refreshRequested = false,
): boolean {
  if (meta.stale === true) return false;
  if (refreshRequested && !isUpstreamRefreshResult(meta)) return false;
  return !local || shouldUseServerSnapshot(local, meta.fetchedAt);
}

export function isCacheStale(
  snapshot: CacheMetadata | null,
  maxAgeMs: number,
  now = Date.now(),
): boolean {
  if (!snapshot) return true;
  const refreshedAt =
    timestampValue(snapshot.serverFetchedAt) || snapshot.localStoredAt;
  return !refreshedAt || now - refreshedAt >= maxAgeMs;
}

export function claimAutomaticRefresh(resource: string, account: string) {
  const key = `${resource}:${account.trim()}`;
  if (!account.trim() || automaticRefreshClaims.has(key)) return false;
  automaticRefreshClaims.add(key);
  return true;
}

/** 每次小程序重新进入前台允许各资源再进行一次到期检查。 */
export function beginAutomaticRefreshCycle(): void {
  automaticRefreshClaims.clear();
}
