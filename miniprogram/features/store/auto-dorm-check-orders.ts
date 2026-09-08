import type { AutoDormCheckOrderHistoryItem, Paginated } from "../../types/api";

export type OrderHistory = Paginated<AutoDormCheckOrderHistoryItem>;
const PREFIX = "easy-swu:auto-dorm-check-orders:v1:";

export function loadOrderHistory(account: string): OrderHistory | null {
  if (!account) return null;
  try {
    const value = wx.getStorageSync(
      PREFIX + encodeURIComponent(account),
    ) as OrderHistory;
    return value && Array.isArray(value.items) && value.pagination?.page === 1
      ? value
      : null;
  } catch {
    return null;
  }
}

export function saveOrderHistory(account: string, value: OrderHistory): void {
  if (!account) return;
  try {
    wx.setStorageSync(PREFIX + encodeURIComponent(account), value);
  } catch {
    // The currently displayed orders remain available without persistent storage.
  }
}
