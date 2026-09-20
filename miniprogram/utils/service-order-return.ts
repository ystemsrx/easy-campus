import { getSession } from "../store/session";
import { navigateTo } from "./navigation";
let pending: { code: string; id: string; tradeNo: string; expires: number } | null = null;
export function rememberServiceOrder(code: string, id: string, tradeNo = ""): void {
  // Only this dedicated route is retained; arbitrary login redirects are never accepted.
  pending = { code, id, tradeNo, expires: Date.now() + 30 * 60 * 1000 };
}
export function resumeServiceOrder(): void {
  if (!getSession()?.token || !pending) return;
  const target = pending;
  pending = null;
  if (target.expires <= Date.now()) return;
  const query = [
    target.code ? `code=${encodeURIComponent(target.code)}` : "",
    target.id ? `id=${encodeURIComponent(target.id)}` : "",
    target.tradeNo ? `out_trade_no=${encodeURIComponent(target.tradeNo)}` : "",
  ].filter(Boolean).join("&");
  void navigateTo(`/features/pages/service-order/index?${query}`);
}
