import { getSession } from "../store/session";
import { recordVisit } from "../store/visits";

let foreground = false;
const recordedAccounts = new Set<string>();

export function syncVisitSession(): void {
  if (!foreground) return;
  const account = getSession()?.user.account;
  if (!account || recordedAccounts.has(account)) return;
  recordedAccounts.add(account);
  recordVisit(account);
}

export function startVisitTracking(): void {
  if (!foreground) recordedAccounts.clear();
  foreground = true;
  syncVisitSession();
}

export function stopVisitTracking(): void {
  foreground = false;
}
