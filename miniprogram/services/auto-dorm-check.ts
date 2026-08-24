import type { AutoDormCheckStatus } from "../types/api";
import { apiRequest } from "./request";

const ROOT = "/auto-dorm-check";

export function getAutoDormCheckStatus(): Promise<AutoDormCheckStatus> {
  return apiRequest<AutoDormCheckStatus>(`${ROOT}/status`);
}

export function setAutoDormCheckEnabled(
  enabled: boolean,
): Promise<AutoDormCheckStatus> {
  return apiRequest<AutoDormCheckStatus>(`${ROOT}/preferences`, {
    method: "PUT",
    data: { enabled },
  });
}
