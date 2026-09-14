import { isDemoAccount } from "../demo/identity";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
  loadCurrentUser,
  saveCurrentUser,
  sessionLeaseKey,
} from "../store/session";
import type { CurrentUserData } from "../types/api";
import { apiRequest } from "./request";

const PROFILE_REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
const inFlight = new Map<string, Promise<CurrentUserData>>();
type ProfileRefreshData = Pick<
  CurrentUserData,
  "name" | "profile" | "profileFetchedAt"
>;

/** Called once by the foreground preload, never by a timer or heartbeat. */
export function refreshProfileOnForeground(
  user: CurrentUserData,
): Promise<CurrentUserData> {
  const lease = captureSessionLease();
  const fetchedAt = user.profileFetchedAt
    ? Date.parse(user.profileFetchedAt)
    : NaN;
  if (
    !lease ||
    lease.account !== user.account ||
    isDemoAccount(user.account) ||
    (Number.isFinite(fetchedAt) &&
      Date.now() - fetchedAt < PROFILE_REFRESH_INTERVAL_MS)
  ) {
    return Promise.resolve(user);
  }
  const key = sessionLeaseKey(lease);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = apiRequest<ProfileRefreshData>("/auth/profile/refresh", {
    method: "POST",
    data: {},
    retry: false,
    credentialReauthFeedback: false,
  })
    .then((profile) => {
      if (!isSessionLeaseCurrent(lease)) return user;
      const current = loadCurrentUser();
      if (!current || current.account !== user.account) return user;
      // Preserve companion preferences and credential state changed while fetching.
      const updated = { ...current, ...profile };
      saveCurrentUser(updated);
      return updated;
    })
    .catch(() => user)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}
