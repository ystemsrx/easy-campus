import { getSession } from "../store/session";
import type { HeartbeatData } from "../types/api";
import { apiRequest } from "./request";

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

let heartbeatForeground = false;
let heartbeatInFlight = false;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

function clearHeartbeatTimer(): void {
  if (heartbeatTimer === undefined) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
}

async function reportHeartbeat(): Promise<void> {
  if (heartbeatInFlight) return;
  if (!getSession()?.token) {
    syncHeartbeatSession();
    return;
  }

  heartbeatInFlight = true;
  try {
    await apiRequest<HeartbeatData>("/auth/heartbeat", {
      method: "POST",
      data: {},
      retry: false,
      timeout: HEARTBEAT_TIMEOUT_MS,
    });
  } catch {
    // 心跳失败不打断当前页面；认证失效仍由统一请求层处理。
  } finally {
    heartbeatInFlight = false;
  }
}

export function syncHeartbeatSession(): void {
  clearHeartbeatTimer();
  if (!heartbeatForeground || !getSession()?.token) return;
  void reportHeartbeat();
  heartbeatTimer = setInterval(
    () => void reportHeartbeat(),
    HEARTBEAT_INTERVAL_MS,
  );
}

export function startHeartbeat(): void {
  heartbeatForeground = true;
  syncHeartbeatSession();
}

export function stopHeartbeat(): void {
  heartbeatForeground = false;
  clearHeartbeatTimer();
}
