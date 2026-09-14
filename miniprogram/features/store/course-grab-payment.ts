const PAYMENT_PENDING_PREFIX = "easy-swu:course-grab-payment:v1:";
export interface PendingAutoDormCheckPayment {
  idempotencyKey: string;
  orderId: string | null;
  planId: string;
  createdAt: number;
  planName?: string;
  priceLabel?: string;
  // Only an explicit false proves that this draft has never reached wx.
  paymentInvoked?: boolean;
}

function paymentPendingStorageKey(account: string): string {
  return (
    PAYMENT_PENDING_PREFIX + encodeURIComponent(account.trim().toLowerCase())
  );
}
export function loadPendingAutoDormCheckPayment(
  account: string,
): PendingAutoDormCheckPayment | null {
  if (!account.trim()) return null;
  let value:
    (Partial<PendingAutoDormCheckPayment> & { planCode?: unknown }) | undefined;
  try {
    value = wx.getStorageSync(paymentPendingStorageKey(account)) as
      Partial<PendingAutoDormCheckPayment> | undefined;
  } catch {
    return null;
  }
  if (
    !value ||
    typeof value.idempotencyKey !== "string" ||
    !value.idempotencyKey ||
    ((typeof value.planId !== "string" || !value.planId) &&
      (typeof value.planCode !== "string" || !value.planCode))
  ) {
    return null;
  }
  return {
    idempotencyKey: value.idempotencyKey,
    orderId:
      typeof value.orderId === "string" && value.orderId ? value.orderId : null,
    planId:
      typeof value.planId === "string" && value.planId
        ? value.planId
        : String(value.planCode),
    createdAt: Number(value.createdAt) || 0,
    planName: typeof value.planName === "string" ? value.planName : "",
    priceLabel: typeof value.priceLabel === "string" ? value.priceLabel : "",
    paymentInvoked: value.paymentInvoked !== false,
  };
}

export function savePendingAutoDormCheckPayment(
  account: string,
  payment: PendingAutoDormCheckPayment,
): boolean {
  if (!account.trim()) return false;
  try {
    const previous = loadPendingAutoDormCheckPayment(account);
    const record =
      previous?.idempotencyKey === payment.idempotencyKey &&
      previous.paymentInvoked !== false
        ? { ...payment, paymentInvoked: true }
        : payment;
    wx.setStorageSync(paymentPendingStorageKey(account), record);
    const stored = loadPendingAutoDormCheckPayment(account);
    return Boolean(
      stored &&
      stored.idempotencyKey === payment.idempotencyKey &&
      stored.orderId === payment.orderId &&
      stored.planId === payment.planId &&
      stored.createdAt === payment.createdAt &&
      stored.planName === (payment.planName || "") &&
      stored.priceLabel === (payment.priceLabel || "") &&
      stored.paymentInvoked === (payment.paymentInvoked !== false),
    );
  } catch {
    return false;
  }
}

export function clearPendingAutoDormCheckPayment(account: string): void {
  if (!account.trim()) return;
  try {
    wx.removeStorageSync(paymentPendingStorageKey(account));
  } catch {
    // 下次读取仍会由服务端订单终态纠正。
  }
}
