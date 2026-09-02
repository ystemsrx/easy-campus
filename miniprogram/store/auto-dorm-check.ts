import type {
  AutoDormCheckLocation,
  AutoDormCheckState,
  AutoDormCheckStatus,
} from "../types/api";

const PREFIX = "easy-swu:auto-dorm-check:v1:";
const LOCATION_PREFIX = "easy-swu:auto-dorm-check-location:v1:";
const PAYMENT_PENDING_PREFIX = "easy-swu:auto-dorm-check-payment:v1:";
let autoDormCheckRevision = 0;
const VALID_STATES = new Set<AutoDormCheckState>([
  "checked_in",
  "pending",
  "skipped",
  "failed",
  "unavailable",
  "disabled",
  "agreement_required",
  "payment_required",
]);

export interface AutoDormCheckSnapshot {
  entryEnabled: boolean;
  checkInStatus: AutoDormCheckState;
  paymentEnabled: boolean | null;
  remainingDays: number;
  remainingUses: number;
  status: AutoDormCheckStatus | null;
  localStoredAt: number;
}

export interface PendingAutoDormCheckPayment {
  idempotencyKey: string;
  orderId: string | null;
  planId: string;
  createdAt: number;
}

export function getAutoDormCheckRevision(): number {
  return autoDormCheckRevision;
}

function storageKey(account: string): string {
  return `${PREFIX}${encodeURIComponent(account.trim().toLowerCase())}`;
}

function paymentPendingStorageKey(account: string): string {
  return `${PAYMENT_PENDING_PREFIX}${encodeURIComponent(account.trim().toLowerCase())}`;
}

function locationStorageKey(account: string): string {
  return `${LOCATION_PREFIX}${encodeURIComponent(account.trim().toLowerCase())}`;
}

export function loadAutoDormCheckSnapshot(
  account: string,
): AutoDormCheckSnapshot | null {
  if (!account.trim()) return null;
  const value = wx.getStorageSync(storageKey(account)) as
    Partial<AutoDormCheckSnapshot> | undefined;
  if (
    !value ||
    typeof value.entryEnabled !== "boolean" ||
    !VALID_STATES.has(value.checkInStatus as AutoDormCheckState)
  ) {
    return null;
  }
  const status = cachedStatus(value.status);
  return {
    entryEnabled: value.entryEnabled,
    checkInStatus: value.checkInStatus as AutoDormCheckState,
    paymentEnabled:
      typeof value.paymentEnabled === "boolean" ? value.paymentEnabled : null,
    remainingDays: Math.max(0, Math.floor(Number(value.remainingDays) || 0)),
    remainingUses: Math.max(0, Math.floor(Number(value.remainingUses) || 0)),
    status: status ? withCachedAutoDormCheckLocation(account, status) : null,
    localStoredAt: Number(value.localStoredAt) || 0,
  };
}

function cachedLocation(value: unknown): AutoDormCheckLocation | null {
  if (!value || typeof value !== "object") return null;
  const location = value as Partial<AutoDormCheckLocation>;
  if (
    typeof location.locationName !== "string" ||
    !location.locationName.trim() ||
    (location.latitude !== null && typeof location.latitude !== "number") ||
    (location.longitude !== null && typeof location.longitude !== "number") ||
    (location.accuracyMeters !== null &&
      typeof location.accuracyMeters !== "number") ||
    (location.checkedAt !== null && typeof location.checkedAt !== "string") ||
    typeof location.sourceTimezone !== "string"
  ) {
    return null;
  }
  return location as AutoDormCheckLocation;
}

export function loadAutoDormCheckLocation(
  account: string,
): AutoDormCheckLocation | null {
  if (!account.trim()) return null;
  try {
    return cachedLocation(wx.getStorageSync(locationStorageKey(account)));
  } catch {
    return null;
  }
}

export function saveAutoDormCheckLocation(
  account: string,
  location: AutoDormCheckLocation,
): void {
  if (!account.trim() || !cachedLocation(location)) return;
  try {
    wx.setStorageSync(locationStorageKey(account), location);
  } catch {
    // 地点仍会保留在本次页面状态和服务端缓存中。
  }
}

export function withCachedAutoDormCheckLocation(
  account: string,
  status: AutoDormCheckStatus,
): AutoDormCheckStatus {
  if (status.checkInLocation) return status;
  const location = loadAutoDormCheckLocation(account);
  return location ? { ...status, checkInLocation: location } : status;
}

function cachedStatus(value: unknown): AutoDormCheckStatus | null {
  if (!value || typeof value !== "object") return null;
  const status = value as Partial<AutoDormCheckStatus>;
  if (
    typeof status.entryEnabled !== "boolean" ||
    typeof status.functionEnabled !== "boolean" ||
    typeof status.available !== "boolean" ||
    !Number.isInteger(status.agreementVersion) ||
    Number(status.agreementVersion) < 1 ||
    typeof status.agreementAccepted !== "boolean" ||
    (status.agreementAcceptedAt !== null &&
      typeof status.agreementAcceptedAt !== "string") ||
    typeof status.enabled !== "boolean" ||
    typeof status.effectiveEnabled !== "boolean" ||
    !VALID_STATES.has(status.checkInStatus as AutoDormCheckState) ||
    typeof status.checkInStartTime !== "string" ||
    typeof status.checkInEndTime !== "string" ||
    typeof status.paymentEnabled !== "boolean" ||
    typeof status.accessGranted !== "boolean" ||
    !status.entitlement ||
    typeof status.entitlement.time?.remainingSeconds !== "number" ||
    typeof status.entitlement.time?.remainingDays !== "number" ||
    typeof status.entitlement.uses?.remaining !== "number"
  ) {
    return null;
  }
  return status as AutoDormCheckStatus;
}

export function saveAutoDormCheckSnapshot(
  account: string,
  status: AutoDormCheckStatus,
): AutoDormCheckSnapshot | null {
  if (!account.trim()) return null;
  const cachedStatus = withCachedAutoDormCheckLocation(account, status);
  if (cachedStatus.checkInLocation) {
    saveAutoDormCheckLocation(account, cachedStatus.checkInLocation);
  }
  const snapshot: AutoDormCheckSnapshot = {
    entryEnabled: cachedStatus.entryEnabled,
    checkInStatus: cachedStatus.checkInStatus,
    paymentEnabled: cachedStatus.paymentEnabled,
    remainingDays: Math.max(
      0,
      Math.floor(Number(cachedStatus.entitlement?.time.remainingDays) || 0),
    ),
    remainingUses: Math.max(
      0,
      Math.floor(Number(cachedStatus.entitlement?.uses.remaining) || 0),
    ),
    status: cachedStatus,
    localStoredAt: Date.now(),
  };
  try {
    wx.setStorageSync(storageKey(account), snapshot);
    autoDormCheckRevision += 1;
  } catch {
    // 写入失败时，本次应用生命周期仍可复用主页发出的请求。
  }
  return snapshot;
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
  };
}

export function savePendingAutoDormCheckPayment(
  account: string,
  payment: PendingAutoDormCheckPayment,
): boolean {
  if (!account.trim()) return false;
  try {
    wx.setStorageSync(paymentPendingStorageKey(account), payment);
    const stored = loadPendingAutoDormCheckPayment(account);
    return Boolean(
      stored &&
      stored.idempotencyKey === payment.idempotencyKey &&
      stored.orderId === payment.orderId &&
      stored.planId === payment.planId &&
      stored.createdAt === payment.createdAt,
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
