import { apiRequest } from "./request";
import { captureSessionLease, isSessionLeaseCurrent } from "../store/session";
import type { AutoDormCheckOrderHistoryItem } from "../types/api";
export interface CourseGrabTask {
  id: string;
  searchKeywords: string[];
  positiveKeywords: string[];
  negativeKeywords: string[];
  scheduledAt: string;
  sourceTimezone: string;
  preferredEnabled: boolean;
  enabled: boolean;
  state: string;
  resultCode: string | null;
  retryCount?: number;
  nextRetryAt?: string | null;
  selectedCourse: { courseName?: string; sectionId?: string } | null;
  generation: number;
  updatedAt: string;
}
export interface CourseGrabStatus {
  entryEnabled: boolean;
  settingsVersion: number;
  balance: { remaining: number; reserved: number; consumed: number };
  tasks: CourseGrabTask[];
  observedAt: string;
}
export interface CourseGrabInput {
  id?: string;
  searchKeywords: string[];
  positiveKeywords: string[];
  negativeKeywords: string[];
  scheduledAt: string;
  sourceTimezone: string;
  enabled?: boolean;
}
export interface RefundQuote {
  refundable: boolean;
  amountCents: number;
  unavailableReason: string | null;
  requiresApple: boolean;
}
export interface CourseGrabOrder extends AutoDormCheckOrderHistoryItem {
  refund: RefundQuote;
}
const ROOT = "/course-grab";
const storageKey = (account: string) =>
  `easy-swu:course-grab:v1:${encodeURIComponent(account)}`;
export function loadCourseGrabStatus(account: string): CourseGrabStatus | null {
  try {
    const data = wx.getStorageSync(storageKey(account)) as CourseGrabStatus;
    return data &&
      typeof data.entryEnabled === "boolean" &&
      Array.isArray(data.tasks) &&
      Number.isFinite(Date.parse(data.observedAt))
      ? data
      : null;
  } catch {
    return null;
  }
}
async function statusRequest(
  path: string,
  options: Parameters<typeof apiRequest>[1] = {},
): Promise<CourseGrabStatus> {
  const lease = captureSessionLease();
  const data = await apiRequest<CourseGrabStatus>(ROOT + path, options);
  if (lease && isSessionLeaseCurrent(lease)) {
    const previous = loadCourseGrabStatus(lease.account);
    if (
      !previous ||
      Date.parse(data.observedAt) >= Date.parse(previous.observedAt)
    )
      try {
        wx.setStorageSync(storageKey(lease.account), data);
      } catch {
        /* Keep the current view. */
      }
  }
  return data;
}
export const getCourseGrabStatus = () => statusRequest("/status");
export const saveCourseGrab = (input: CourseGrabInput, id?: string) =>
  statusRequest(id ? `/tasks/${encodeURIComponent(id)}` : "/tasks", {
    method: id ? "PUT" : "POST",
    data: input,
  });
export const toggleCourseGrab = (id: string, enabled: boolean) =>
  statusRequest(`/tasks/${encodeURIComponent(id)}/enabled`, {
    method: "PUT",
    data: { enabled },
  });
export const deleteCourseGrab = (id: string) =>
  statusRequest(`/tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
    data: {},
  });
export const getCourseGrabOrders = (page = 1) =>
  apiRequest<{
    items: CourseGrabOrder[];
    pagination: { page: number; totalPages: number; total: number };
  }>(`${ROOT}/payment/orders?page=${page}&pageSize=20`);
export const refundCourseGrab = (
  id: string,
  amountCents: number,
  key: string,
) =>
  apiRequest<{ status: string }>(
    `${ROOT}/payment/orders/${encodeURIComponent(id)}/refund`,
    {
      method: "POST",
      data: { expectedAmountCents: amountCents },
      headers: { "Idempotency-Key": key },
    },
  );
