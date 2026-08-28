import { getApiUrl } from "../config/index";
import {
  captureSessionLease,
  clearSession,
  clearSessionIfCurrent,
  getSession,
  isSessionLeaseCurrent,
  queueAccountDeactivatedNotice,
  queueSessionInvalidNotice,
  type SessionLease,
} from "../store/session";
import type {
  ApiErrorPayload,
  ApiSuccess,
  QueryMeta,
  TeachingSuccess,
} from "../types/api";
import { goToLogin } from "../utils/navigation";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

interface RequestOptions {
  method?: HttpMethod;
  data?: WechatMiniprogram.IAnyObject | string | ArrayBuffer;
  authenticated?: boolean;
  retry?: boolean;
  timeout?: number;
}

interface SuccessEnvelope<T> extends ApiSuccess<T> {
  meta?: QueryMeta;
}

const AUTH_ERROR_CODES = new Set([
  "INVALID_TOKEN",
  "USER_NOT_FOUND",
  "SWU_AUTH_FAILED",
  "SWU_CREDENTIAL_INVALID",
  "SWU_SESSION_INVALIDATED",
]);
const CREDENTIAL_INVALIDATION_CODES = new Set([
  "SWU_AUTH_FAILED",
  "SWU_CREDENTIAL_INVALID",
]);
const RETRYABLE_ERROR_CODES = new Set(["SWU_SESSION_EXPIRED"]);
const RETRYABLE_STATUS_CODES = new Set([503]);
const ACCOUNT_DEACTIVATED_ERROR_CODE = "ACCOUNT_DEACTIVATED";
const STALE_SESSION_ERROR_CODE = "STALE_SESSION";
export const ACCOUNT_DEACTIVATED_MESSAGE = "账户已停用";
let redirectingToLogin = false;

export class ApiClientError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(options: {
    code: string;
    message: string;
    statusCode: number;
    details?: unknown;
    requestId?: string;
  }) {
    super(options.message);
    this.name = "ApiClientError";
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

interface RateLimitToastController {
  show(): void;
}

function showRateLimitToast(): void {
  const pages = getCurrentPages();
  const currentPage = pages[pages.length - 1];
  const toast = currentPage?.selectComponent?.(
    "#rate-limit-toast",
  ) as unknown as RateLimitToastController | undefined;
  if (toast && typeof toast.show === "function") {
    toast.show();
    return;
  }
  wx.showToast({ title: "访问速度太快了", icon: "none", duration: 3000 });
}

function redirectAfterAuthFailure(
  credentialInvalid = false,
  lease?: SessionLease | null,
): void {
  if (lease === undefined) {
    clearSession();
  } else if (!clearSessionIfCurrent(lease)) {
    return;
  }
  if (credentialInvalid) {
    queueSessionInvalidNotice();
  } else {
    wx.showToast({
      title: "登录已失效，请重新登录",
      icon: "none",
      duration: 2200,
    });
  }
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  setTimeout(
    () => {
      if (!getSession()) goToLogin();
      redirectingToLogin = false;
    },
    credentialInvalid ? 0 : 320,
  );
}

function redirectAfterAccountDeactivation(lease?: SessionLease | null): void {
  if (lease !== undefined) {
    if (!clearSessionIfCurrent(lease)) return;
  } else {
    clearSession();
  }
  queueAccountDeactivatedNotice();
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  setTimeout(() => {
    if (!getSession()) goToLogin();
    redirectingToLogin = false;
  }, 0);
}

function isSuccessEnvelope<T>(value: unknown): value is SuccessEnvelope<T> {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { success?: unknown }).success === true &&
    "data" in value,
  );
}

function toApiError(data: unknown, statusCode: number): ApiClientError {
  const payload = data as Partial<ApiErrorPayload> | undefined;
  if (payload?.success === false && payload.error) {
    return new ApiClientError({
      code: payload.error.code || "REQUEST_FAILED",
      message: payload.error.message || "请求失败，请稍后重试。",
      statusCode,
      details: payload.error.details,
      requestId: payload.requestId,
    });
  }

  return new ApiClientError({
    code: statusCode === 0 ? "NETWORK_ERROR" : "INVALID_RESPONSE",
    message:
      statusCode === 0
        ? "网络连接失败，请检查网络后重试。"
        : "服务返回了无法识别的数据。",
    statusCode,
  });
}

function staleSessionError(): ApiClientError {
  return new ApiClientError({
    code: STALE_SESSION_ERROR_CODE,
    message: "登录账号已经切换。",
    statusCode: 0,
  });
}

interface RequestContext {
  authenticated: boolean;
  lease: SessionLease | null;
}

function createRequestContext(options: RequestOptions): RequestContext {
  const authenticated = options.authenticated !== false;
  return {
    authenticated,
    lease: authenticated ? captureSessionLease() : null,
  };
}

function requestOnce<T>(
  path: string,
  options: RequestOptions,
  context: RequestContext,
): Promise<SuccessEnvelope<T>> {
  const { authenticated, lease } = context;
  if (authenticated && !lease) {
    const error = new ApiClientError({
      code: "INVALID_TOKEN",
      message: "请先登录。",
      statusCode: 401,
    });
    redirectAfterAuthFailure();
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: getApiUrl(path),
      method: options.method || "GET",
      data: options.data,
      timeout: options.timeout || 30000,
      header: {
        Accept: "application/json",
        ...(options.method && options.method !== "GET"
          ? { "Content-Type": "application/json" }
          : {}),
        ...(lease ? { Authorization: `Bearer ${lease.token}` } : {}),
      },
      success: (response) => {
        if (authenticated && !isSessionLeaseCurrent(lease)) {
          reject(staleSessionError());
          return;
        }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (isSuccessEnvelope<T>(response.data)) {
            resolve(response.data);
            return;
          }
          reject(toApiError(response.data, response.statusCode));
          return;
        }

        const error = toApiError(response.data, response.statusCode);
        if (authenticated && error.code === ACCOUNT_DEACTIVATED_ERROR_CODE) {
          redirectAfterAccountDeactivation(lease);
        }
        if (
          authenticated &&
          (AUTH_ERROR_CODES.has(error.code) ||
            (error.code === "SWU_SESSION_EXPIRED" && options.retry === false))
        ) {
          redirectAfterAuthFailure(
            CREDENTIAL_INVALIDATION_CODES.has(error.code),
            lease,
          );
        }
        reject(error);
      },
      fail: () => {
        if (authenticated && !isSessionLeaseCurrent(lease)) {
          reject(staleSessionError());
          return;
        }
        reject(toApiError(undefined, 0));
      },
    });
  });
}

async function requestEnvelope<T>(
  path: string,
  options: RequestOptions = {},
): Promise<SuccessEnvelope<T>> {
  const context = createRequestContext(options);
  try {
    return await requestOnce<T>(path, options, context);
  } catch (error) {
    const apiError = error as ApiClientError;
    if (isRateLimitError(apiError)) {
      showRateLimitToast();
      throw error;
    }
    const retryable =
      options.retry !== false &&
      (apiError.code === "NETWORK_ERROR" ||
        RETRYABLE_ERROR_CODES.has(apiError.code) ||
        RETRYABLE_STATUS_CODES.has(apiError.statusCode));
    if (!retryable) {
      throw error;
    }

    await wait(360);
    if (context.authenticated && !isSessionLeaseCurrent(context.lease)) {
      throw staleSessionError();
    }
    return requestOnce<T>(path, { ...options, retry: false }, context);
  }
}

export function handleAuthenticationFailure(
  error: ApiClientError,
  lease?: SessionLease | null,
): void {
  if (error.code === ACCOUNT_DEACTIVATED_ERROR_CODE) {
    redirectAfterAccountDeactivation(lease);
    return;
  }
  if (error.statusCode === 401 || AUTH_ERROR_CODES.has(error.code)) {
    redirectAfterAuthFailure(
      CREDENTIAL_INVALIDATION_CODES.has(error.code),
      lease,
    );
  }
}

export function handleCredentialInvalidation(
  lease?: SessionLease | null,
): void {
  redirectAfterAuthFailure(true, lease);
}

export async function apiRequest<T>(
  path: string,
  options?: RequestOptions,
): Promise<T> {
  const envelope = await requestEnvelope<T>(path, options);
  return envelope.data;
}

export async function teachingRequest<T>(
  path: string,
  options?: RequestOptions,
): Promise<{ data: T; meta: QueryMeta }> {
  const envelope = (await requestEnvelope<T>(
    path,
    options,
  )) as TeachingSuccess<T>;
  return {
    data: envelope.data,
    meta: envelope.meta || { cached: false },
  };
}

export function getErrorMessage(
  error: unknown,
  fallback = "加载失败，请稍后重试。",
): string {
  if (
    error instanceof ApiClientError &&
    error.code === ACCOUNT_DEACTIVATED_ERROR_CODE
  ) {
    return ACCOUNT_DEACTIVATED_MESSAGE;
  }
  if (isRateLimitError(error)) return "";
  if (error instanceof ApiClientError && error.message) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export function isRateLimitError(error: unknown): boolean {
  return error instanceof ApiClientError && error.statusCode === 429;
}
