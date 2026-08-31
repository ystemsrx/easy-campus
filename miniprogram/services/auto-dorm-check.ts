import type {
  AutoDormCheckPaymentData,
  AutoDormCheckPaymentOrderResult,
  AutoDormCheckLocation,
  AutoDormCheckStatus,
} from "../types/api";
import {
  saveAutoDormCheckLocation,
  saveAutoDormCheckSnapshot,
} from "../store/auto-dorm-check";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
  sessionLeaseKey,
} from "../store/session";
import { apiRequest } from "./request";

const ROOT = "/auto-dorm-check";

interface PendingStatusRequest {
  key: string;
  promise: Promise<AutoDormCheckStatus>;
  revision: number;
}

interface PendingPaymentRequest {
  key: string;
  promise: Promise<AutoDormCheckPaymentData>;
  revision: number;
}

interface PendingLocationRequest {
  key: string;
  promise: Promise<AutoDormCheckLocation | null>;
}

interface CachedPayment {
  key: string;
  data: AutoDormCheckPaymentData;
  receivedAt: number;
}

let pendingStatusRequest: PendingStatusRequest | null = null;
let statusRequestRevision = 0;
let pendingLocationRequest: PendingLocationRequest | null = null;
let pendingPaymentRequest: PendingPaymentRequest | null = null;
let cachedPayment: CachedPayment | null = null;
let paymentRequestRevision = 0;
const PAYMENT_PREFETCH_MAX_AGE_MILLISECONDS = 30_000;

function requestStatus(
  request: () => Promise<AutoDormCheckStatus>,
  reusePending = false,
): Promise<AutoDormCheckStatus> {
  const lease = captureSessionLease();
  if (!lease) return request();
  const key = sessionLeaseKey(lease);
  if (reusePending && pendingStatusRequest?.key === key) {
    return pendingStatusRequest.promise;
  }

  const revision = ++statusRequestRevision;
  let promise!: Promise<AutoDormCheckStatus>;
  promise = request()
    .then((status) => {
      if (
        isSessionLeaseCurrent(lease) &&
        pendingStatusRequest?.key === key &&
        pendingStatusRequest.revision === revision
      ) {
        return (
          saveAutoDormCheckSnapshot(lease.account, status)?.status || status
        );
      }
      return status;
    })
    .finally(() => {
      if (pendingStatusRequest?.promise === promise) {
        pendingStatusRequest = null;
      }
    });
  pendingStatusRequest = { key, promise, revision };
  return promise;
}

export function getAutoDormCheckStatus(): Promise<AutoDormCheckStatus> {
  return requestStatus(() =>
    apiRequest<AutoDormCheckStatus>(`${ROOT}/status?refresh=true`),
  );
}

export function getAutoDormCheckLocalStatus(): Promise<AutoDormCheckStatus> {
  return requestStatus(() => apiRequest<AutoDormCheckStatus>(`${ROOT}/status`));
}

export function getAutoDormCheckLocation(): Promise<AutoDormCheckLocation | null> {
  const lease = captureSessionLease();
  if (!lease) {
    return apiRequest<AutoDormCheckLocation | null>(`${ROOT}/location`);
  }
  const key = sessionLeaseKey(lease);
  if (pendingLocationRequest?.key === key) {
    return pendingLocationRequest.promise;
  }

  let promise!: Promise<AutoDormCheckLocation | null>;
  promise = apiRequest<AutoDormCheckLocation | null>(`${ROOT}/location`)
    .then((location) => {
      if (location && isSessionLeaseCurrent(lease)) {
        saveAutoDormCheckLocation(lease.account, location);
      }
      return location;
    })
    .finally(() => {
      if (pendingLocationRequest?.promise === promise) {
        pendingLocationRequest = null;
      }
    });
  pendingLocationRequest = { key, promise };
  return promise;
}

/** 每次进入主页时静默刷新，供“我的”页直接复用。 */
export function preloadAutoDormCheckStatus(): Promise<AutoDormCheckStatus> {
  return requestStatus(
    () => apiRequest<AutoDormCheckStatus>(`${ROOT}/status`),
    true,
  );
}

/** 只返回主页已经发出的请求，不在“我的”页触发新请求。 */
export function getPendingAutoDormCheckStatus(): Promise<AutoDormCheckStatus> | null {
  const lease = captureSessionLease();
  if (!lease) return null;
  return pendingStatusRequest?.key === sessionLeaseKey(lease)
    ? pendingStatusRequest.promise
    : null;
}

export function setAutoDormCheckEnabled(
  enabled: boolean,
): Promise<AutoDormCheckStatus> {
  return requestStatus(() =>
    apiRequest<AutoDormCheckStatus>(`${ROOT}/preferences`, {
      method: "PUT",
      data: { enabled },
      credentialReauthFeedback: true,
    }),
  );
}

export function setAutoDormCheckAgreement(
  accepted: boolean,
  version: number,
): Promise<AutoDormCheckStatus> {
  return requestStatus(() =>
    apiRequest<AutoDormCheckStatus>(`${ROOT}/agreement`, {
      method: "PUT",
      data: { accepted, version },
    }),
  );
}

function requestPayment(
  reusePending = false,
): Promise<AutoDormCheckPaymentData> {
  const lease = captureSessionLease();
  if (!lease) {
    return apiRequest<AutoDormCheckPaymentData>(`${ROOT}/payment`);
  }
  const key = sessionLeaseKey(lease);
  if (reusePending && pendingPaymentRequest?.key === key) {
    return pendingPaymentRequest.promise;
  }

  const revision = ++paymentRequestRevision;
  let promise!: Promise<AutoDormCheckPaymentData>;
  promise = apiRequest<AutoDormCheckPaymentData>(`${ROOT}/payment`)
    .then((payment) => {
      if (isSessionLeaseCurrent(lease) && revision === paymentRequestRevision) {
        cachedPayment = { key, data: payment, receivedAt: Date.now() };
      }
      return payment;
    })
    .finally(() => {
      if (pendingPaymentRequest?.promise === promise) {
        pendingPaymentRequest = null;
      }
    });
  pendingPaymentRequest = { key, promise, revision };
  return promise;
}

export function getAutoDormCheckPayment(): Promise<AutoDormCheckPaymentData> {
  return requestPayment();
}

/** 进入自动查寝页时后台预取，套餐页复用同一请求。 */
export function preloadAutoDormCheckPayment(): Promise<AutoDormCheckPaymentData> {
  return requestPayment(true);
}

export function getPendingAutoDormCheckPayment(): Promise<AutoDormCheckPaymentData> | null {
  const lease = captureSessionLease();
  if (!lease) return null;
  return pendingPaymentRequest?.key === sessionLeaseKey(lease)
    ? pendingPaymentRequest.promise
    : null;
}

export function getCachedAutoDormCheckPayment(): AutoDormCheckPaymentData | null {
  const lease = captureSessionLease();
  if (!lease || cachedPayment?.key !== sessionLeaseKey(lease)) return null;
  if (
    Date.now() - cachedPayment.receivedAt >
    PAYMENT_PREFETCH_MAX_AGE_MILLISECONDS
  ) {
    return null;
  }
  return cachedPayment.data;
}

export function createAutoDormCheckPaymentOrder(
  planId: string,
  idempotencyKey: string,
): Promise<AutoDormCheckPaymentOrderResult> {
  return apiRequest<AutoDormCheckPaymentOrderResult>(`${ROOT}/payment/orders`, {
    method: "POST",
    data: { planId },
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function getAutoDormCheckPaymentOrder(
  orderId: string,
): Promise<AutoDormCheckPaymentOrderResult> {
  return apiRequest<AutoDormCheckPaymentOrderResult>(
    `${ROOT}/payment/orders/${encodeURIComponent(orderId)}`,
  );
}
