import { getApiUrl } from "../config/index";
import {
  captureSessionLease,
  clearSession,
  clearSessionIfCurrent,
  getSession,
  isSessionLeaseCurrent,
  queueAccountDeactivatedNotice,
  sessionLeaseKey,
  type SessionLease,
  updateSessionCredential,
  updateSessionDevice,
} from "../store/session";
import type {
  ApiErrorPayload,
  ApiSuccess,
  QueryMeta,
  TeachingSuccess,
} from "../types/api";
import { goToLogin } from "../utils/navigation";
import {
  canonicalRequestTarget,
  createDeviceProofHeaders,
  getDevicePublicKey,
  hashRequestData,
} from "./device-proof";
import type { DeviceBinding } from "../types/api";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

interface RequestOptions {
  method?: HttpMethod;
  data?: WechatMiniprogram.IAnyObject | string | ArrayBuffer;
  authenticated?: boolean;
  retry?: boolean;
  timeout?: number;
  allowInvalidCredential?: boolean;
  credentialReauthFeedback?: boolean;
}

interface SuccessEnvelope<T> extends ApiSuccess<T> {
  meta?: QueryMeta;
}

const AUTH_ERROR_CODES = new Set([
  "INVALID_TOKEN",
  "USER_NOT_FOUND",
  "SWU_SESSION_INVALIDATED",
  "DEVICE_ENROLLMENT_REQUIRED",
  "DEVICE_PROOF_REQUIRED",
  "DEVICE_KEY_MISMATCH",
  "DEVICE_KEY_REVOKED",
  "DEVICE_SIGNATURE_INVALID",
]);
const CREDENTIAL_REAUTH_CODES = new Set([
  "SWU_CREDENTIAL_REAUTH_REQUIRED",
  "SWU_CREDENTIAL_INVALID",
]);
const CAMPUS_CREDENTIAL_INVALIDATION_CODES = new Set([
  "SWU_AUTH_FAILED",
  "SWU_ACCOUNT_LOCKED",
  "SWU_ACCOUNT_INACTIVE",
  "SWU_PASSWORD_EXPIRED",
  "SWU_ADDITIONAL_VERIFICATION_REQUIRED",
  "SWU_OFFICE_ACCOUNT_NOT_FOUND",
  "SWU_UNSUPPORTED_STUDENT",
  "SWU_ACCOUNT_DISABLED",
  "SWU_AUTH_RESPONSE_UNEXPECTED",
]);
const RETRYABLE_ERROR_CODES = new Set(["SWU_SESSION_EXPIRED"]);
const RETRYABLE_STATUS_CODES = new Set([503]);
const ACCOUNT_DEACTIVATED_ERROR_CODE = "ACCOUNT_DEACTIVATED";
const STALE_SESSION_ERROR_CODE = "STALE_SESSION";
export const ACCOUNT_DEACTIVATED_MESSAGE = "账户已停用";
export const CREDENTIAL_REAUTH_REQUIRED_CODE = "SWU_CREDENTIAL_REAUTH_REQUIRED";
export const CREDENTIAL_REAUTH_REQUIRED_MESSAGE = "验证失败，请重新登录小程序";
export const FEEDBACK_DAILY_LIMITED_CODE = "FEEDBACK_DAILY_LIMITED";
export const FEEDBACK_DAILY_LIMITED_MESSAGE = "反馈已收到，明天再来吧";
let redirectingToLogin = false;
let deviceEnrollmentFlight: {
  leaseKey: string;
  promise: Promise<void>;
} | null = null;

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
  show(message?: string): void;
}

function showRateLimitToast(message = "访问速度太快了"): void {
  const pages = getCurrentPages();
  const currentPage = pages[pages.length - 1];
  const toast = currentPage?.selectComponent?.(
    "#rate-limit-toast",
  ) as unknown as RateLimitToastController | undefined;
  if (toast && typeof toast.show === "function") {
    toast.show(message);
    return;
  }
  wx.showToast({ title: message, icon: "none", duration: 3000 });
}

function redirectAfterAuthFailure(lease?: SessionLease | null): void {
  if (lease === undefined) {
    clearSession();
  } else if (!clearSessionIfCurrent(lease)) {
    return;
  }
  wx.showToast({
    title: "登录已失效，请重新登录",
    icon: "none",
    duration: 2200,
  });
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  setTimeout(() => {
    if (!getSession()) goToLogin();
    redirectingToLogin = false;
  }, 320);
}

function credentialReauthError(): ApiClientError {
  return new ApiClientError({
    code: CREDENTIAL_REAUTH_REQUIRED_CODE,
    message: CREDENTIAL_REAUTH_REQUIRED_MESSAGE,
    statusCode: 409,
  });
}

function isCredentialInvalidationCode(code: string): boolean {
  return (
    CREDENTIAL_REAUTH_CODES.has(code) ||
    CAMPUS_CREDENTIAL_INVALIDATION_CODES.has(code)
  );
}

export function notifyCredentialReauthRequired(
  lease?: SessionLease | null,
  errorCode = CREDENTIAL_REAUTH_REQUIRED_CODE,
  showFeedback = true,
): ApiClientError {
  if (lease === undefined || isSessionLeaseCurrent(lease)) {
    const session = getSession();
    if (session) {
      updateSessionCredential({
        status: "invalid",
        checkedAt: new Date().toISOString(),
        errorCode,
      });
    }
    if (showFeedback) {
      showRateLimitToast(CREDENTIAL_REAUTH_REQUIRED_MESSAGE);
    }
  }
  return credentialReauthError();
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

interface DeviceEnrollmentData {
  device: DeviceBinding;
  token: string;
  tokenType: "Bearer";
}

async function ensureDeviceEnrollment(
  showCredentialFeedback: boolean,
): Promise<void> {
  const session = getSession();
  if (!session || session.device) return;
  const lease = captureSessionLease(session);
  if (!lease) return;
  const leaseKey = sessionLeaseKey(lease);
  if (deviceEnrollmentFlight?.leaseKey === leaseKey) {
    await deviceEnrollmentFlight.promise;
    return;
  }
  const promise = enrollCurrentDevice(lease, showCredentialFeedback);
  deviceEnrollmentFlight = { leaseKey, promise };
  try {
    await promise;
  } finally {
    if (deviceEnrollmentFlight?.promise === promise) {
      deviceEnrollmentFlight = null;
    }
  }
}

async function enrollCurrentDevice(
  lease: SessionLease,
  showCredentialFeedback: boolean,
): Promise<void> {
  const publicKey = await getDevicePublicKey();
  if (!isSessionLeaseCurrent(lease)) throw staleSessionError();
  const data = await requestProofBootstrap<DeviceEnrollmentData>(
    "/auth/device",
    lease,
    { publicKey },
    showCredentialFeedback,
  );
  if (!isSessionLeaseCurrent(lease)) throw staleSessionError();
  updateSessionDevice(data.device, data.token);
}

function requestProofBootstrap<T>(
  path: string,
  lease: SessionLease,
  data: WechatMiniprogram.IAnyObject,
  showCredentialFeedback: boolean,
): Promise<T> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: getApiUrl(path),
      method: "POST",
      data,
      timeout: 15000,
      header: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${lease.token}`,
      },
      success: (response) => {
        if (!isSessionLeaseCurrent(lease)) {
          reject(staleSessionError());
          return;
        }
        if (
          response.statusCode >= 200 &&
          response.statusCode < 300 &&
          isSuccessEnvelope<T>(response.data)
        ) {
          resolve(response.data.data);
          return;
        }
        const error = toApiError(response.data, response.statusCode);
        if (!isCredentialInvalidationCode(error.code)) {
          handleAuthenticatedRequestError(error, lease, showCredentialFeedback);
        }
        reject(error);
      },
      fail: () => {
        if (!isSessionLeaseCurrent(lease)) {
          reject(staleSessionError());
          return;
        }
        reject(toApiError(undefined, 0));
      },
    });
  });
}

async function createRequestProof(
  path: string,
  options: RequestOptions,
  lease: SessionLease,
): Promise<Record<string, string>> {
  if (!isSessionLeaseCurrent(lease)) throw staleSessionError();
  const session = getSession();
  const device = session?.device;
  if (!device) {
    throw new ApiClientError({
      code: "DEVICE_ENROLLMENT_REQUIRED",
      message: "当前会话需要绑定设备。",
      statusCode: 401,
    });
  }
  const method = options.method || "GET";
  const requestTarget = canonicalRequestTarget(path);
  const bodyHash = hashRequestData(options.data);
  const headers = await createDeviceProofHeaders({
    deviceKeyId: device.id,
    sessionToken: lease.token,
    method,
    requestTarget,
    bodyHash,
  });
  if (!isSessionLeaseCurrent(lease)) throw staleSessionError();
  return headers;
}

function handleAuthenticatedRequestError(
  error: ApiClientError,
  lease: SessionLease | null,
  showCredentialFeedback = false,
): void {
  if (isCredentialInvalidationCode(error.code)) {
    notifyCredentialReauthRequired(lease, error.code, showCredentialFeedback);
    return;
  }
  if (error.code === ACCOUNT_DEACTIVATED_ERROR_CODE) {
    redirectAfterAccountDeactivation(lease);
    return;
  }
  if (AUTH_ERROR_CODES.has(error.code)) {
    redirectAfterAuthFailure(lease);
  }
}

async function requestOnce<T>(
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

  const deviceProofHeaders =
    authenticated && lease
      ? await createRequestProof(path, options, lease)
      : ({} as Record<string, string>);

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
        ...deviceProofHeaders,
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
        if (authenticated) {
          if (!isCredentialInvalidationCode(error.code)) {
            handleAuthenticatedRequestError(
              error,
              lease,
              options.credentialReauthFeedback === true,
            );
          }
          if (error.code === "SWU_SESSION_EXPIRED" && options.retry === false) {
            redirectAfterAuthFailure(lease);
          }
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
  const showCredentialFeedback = options.credentialReauthFeedback === true;
  if (
    options.authenticated !== false &&
    options.allowInvalidCredential !== true &&
    getSession()?.credential.status === "invalid"
  ) {
    throw notifyCredentialReauthRequired(
      captureSessionLease(),
      CREDENTIAL_REAUTH_REQUIRED_CODE,
      showCredentialFeedback,
    );
  }
  if (options.authenticated !== false) {
    try {
      await ensureDeviceEnrollment(showCredentialFeedback);
    } catch (error) {
      const apiError = error as ApiClientError;
      if (isCredentialInvalidationCode(apiError.code)) {
        throw notifyCredentialReauthRequired(
          captureSessionLease(),
          apiError.code,
          showCredentialFeedback,
        );
      }
      if (isRateLimitError(apiError)) showRateLimitToast();
      if (
        options.retry !== false &&
        (apiError.code === "NETWORK_ERROR" ||
          RETRYABLE_STATUS_CODES.has(apiError.statusCode))
      ) {
        await wait(360);
        await ensureDeviceEnrollment(showCredentialFeedback);
      } else {
        throw error;
      }
    }
  }
  const context = createRequestContext(options);
  try {
    return await requestOnce<T>(path, options, context);
  } catch (error) {
    const apiError = error as ApiClientError;
    if (
      context.authenticated &&
      isCredentialInvalidationCode(apiError.code)
    ) {
      throw notifyCredentialReauthRequired(
        context.lease,
        apiError.code,
        showCredentialFeedback,
      );
    }
    if (context.authenticated && AUTH_ERROR_CODES.has(apiError.code)) {
      handleAuthenticatedRequestError(apiError, context.lease);
    }
    if (isRateLimitError(apiError)) {
      showRateLimitToast(
        isFeedbackDailyLimitError(apiError)
          ? FEEDBACK_DAILY_LIMITED_MESSAGE
          : "访问速度太快了",
      );
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
    try {
      return await requestOnce<T>(
        path,
        { ...options, retry: false },
        context,
      );
    } catch (retryError) {
      const retryApiError = retryError as ApiClientError;
      if (
        context.authenticated &&
        isCredentialInvalidationCode(retryApiError.code)
      ) {
        throw notifyCredentialReauthRequired(
          context.lease,
          retryApiError.code,
          showCredentialFeedback,
        );
      }
      throw retryError;
    }
  }
}

export function handleAuthenticationFailure(
  error: ApiClientError,
  lease?: SessionLease | null,
): void {
  if (isCredentialInvalidationCode(error.code)) {
    notifyCredentialReauthRequired(lease, error.code);
    return;
  }
  if (error.code === ACCOUNT_DEACTIVATED_ERROR_CODE) {
    redirectAfterAccountDeactivation(lease);
    return;
  }
  if (error.statusCode === 401 || AUTH_ERROR_CODES.has(error.code)) {
    redirectAfterAuthFailure(lease);
  }
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
  if (isCredentialReauthError(error)) return "";
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

export function isCredentialReauthError(error: unknown): boolean {
  return (
    error instanceof ApiClientError && CREDENTIAL_REAUTH_CODES.has(error.code)
  );
}

export function shouldShowRefreshFailureFeedback(error: unknown): boolean {
  if (isRateLimitError(error) || isCredentialReauthError(error)) return false;
  if (!(error instanceof ApiClientError)) return true;
  return (
    error.code !== ACCOUNT_DEACTIVATED_ERROR_CODE &&
    error.code !== STALE_SESSION_ERROR_CODE &&
    error.code !== "SWU_SESSION_EXPIRED" &&
    !AUTH_ERROR_CODES.has(error.code)
  );
}

export function isFeedbackDailyLimitError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.code === FEEDBACK_DAILY_LIMITED_CODE
  );
}
