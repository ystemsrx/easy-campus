import type { AutoDormCheckStatus } from "../types/api";
import { saveAutoDormCheckSnapshot } from "../store/auto-dorm-check";
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

let pendingStatusRequest: PendingStatusRequest | null = null;
let statusRequestRevision = 0;

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
        saveAutoDormCheckSnapshot(lease.account, status);
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
  return requestStatus(() =>
    apiRequest<AutoDormCheckStatus>(`${ROOT}/status`),
  );
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
