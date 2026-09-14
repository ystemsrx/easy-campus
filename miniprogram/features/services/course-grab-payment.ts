import { apiRequest } from "../../services/request";
import {
  assertVirtualPaymentSupported,
  wechatPaymentLogin,
} from "../../services/auto-dorm-check";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
  sessionLeaseKey,
} from "../../store/session";
import type {
  AutoDormCheckPaymentData,
  AutoDormCheckPaymentOrderResult,
} from "../../types/api";
export { launchWechatPayment } from "../../services/auto-dorm-check";
const ROOT = "/course-grab/payment";
let cached: { key: string; data: AutoDormCheckPaymentData; at: number } | null =
  null;
let pending: {
  key: string;
  promise: Promise<AutoDormCheckPaymentData>;
} | null = null;
let revision = 0;
export function getAutoDormCheckPayment(): Promise<AutoDormCheckPaymentData> {
  const lease = captureSessionLease();
  const version = ++revision;
  const promise = apiRequest<AutoDormCheckPaymentData>(ROOT)
    .then((data) => {
      if (lease && isSessionLeaseCurrent(lease) && version === revision)
        cached = { key: sessionLeaseKey(lease), data, at: Date.now() };
      return data;
    })
    .finally(() => {
      if (pending?.promise === promise) pending = null;
    });
  if (lease) pending = { key: sessionLeaseKey(lease), promise };
  return promise;
}
export function getCachedAutoDormCheckPayment() {
  const lease = captureSessionLease();
  return lease &&
    cached?.key === sessionLeaseKey(lease) &&
    Date.now() - cached.at < 30000
    ? cached.data
    : null;
}
export function getPendingAutoDormCheckPayment() {
  const lease = captureSessionLease();
  return lease && pending?.key === sessionLeaseKey(lease)
    ? pending.promise
    : null;
}
export async function createAutoDormCheckPaymentOrder(
  planId: string,
  idempotencyKey: string,
): Promise<AutoDormCheckPaymentOrderResult> {
  assertVirtualPaymentSupported();
  const code = await wechatPaymentLogin();
  return apiRequest(`${ROOT}/orders`, {
    method: "POST",
    data: { planId, code },
    headers: { "Idempotency-Key": idempotencyKey },
  });
}
export async function resumeAutoDormCheckPaymentOrder(
  orderId: string,
): Promise<AutoDormCheckPaymentOrderResult> {
  const code = await wechatPaymentLogin();
  return apiRequest(`${ROOT}/orders/${encodeURIComponent(orderId)}/pay`, {
    method: "POST",
    data: { code },
  });
}
export function cancelAutoDormCheckPaymentOrder(
  orderId: string,
): Promise<AutoDormCheckPaymentOrderResult> {
  return apiRequest(`${ROOT}/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "POST",
    data: {},
  });
}
export function getAutoDormCheckPaymentOrder(
  orderId: string,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<AutoDormCheckPaymentOrderResult> {
  return apiRequest(
    `${ROOT}/orders/${encodeURIComponent(orderId)}${refresh ? "?refresh=true" : ""}`,
  );
}
