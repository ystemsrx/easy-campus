import { getSession } from "../store/session";
import { navigateTo } from "./navigation";
let pending: { code: string; id: string; expires: number } | null = null;
export function rememberServiceOrder(code: string, id: string): void {
  // Only this dedicated route is retained; arbitrary login redirects are never accepted.
  pending = { code, id, expires: Date.now() + 30 * 60 * 1000 };
}
export function resumeServiceOrder(): void {
  if (!getSession()?.token || !pending) return;
  const target = pending;
  pending = null;
  if (target.expires <= Date.now()) return;
  void navigateTo(`/features/pages/service-order/index?code=${encodeURIComponent(target.code)}&id=${encodeURIComponent(target.id)}`);
}
