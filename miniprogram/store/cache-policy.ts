export const DAY_MS = 24 * 60 * 60 * 1000;
export const FIFTEEN_DAYS_MS = 15 * DAY_MS;

const automaticRefreshClaims = new Set<string>();

export interface CacheMetadata {
  serverFetchedAt: string;
  localStoredAt: number;
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
