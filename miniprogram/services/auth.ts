import { ApiClientError, apiRequest } from "./request";
import {
  assertSessionLeaseCurrent,
  captureSessionLease,
  clearSession,
  clearSessionIfCurrent,
  saveCurrentUser,
  saveSession,
  updateSessionCredential,
} from "../store/session";
import type {
  CredentialState,
  CurrentUserData,
  LoginData,
  Session,
} from "../types/api";
import { synchronizeCompanionPreferences } from "./companion";
import { syncHeartbeatSession } from "./heartbeat";
import { getDevicePublicKey } from "./device-proof";

let loginRequestRevision = 0;

export function cancelPendingLogin(): void {
  loginRequestRevision += 1;
}

export async function login(
  account: string,
  password: string,
): Promise<Session> {
  const revision = ++loginRequestRevision;
  const devicePublicKey = await getDevicePublicKey();
  const data = await apiRequest<LoginData>("/auth/login", {
    method: "POST",
    data: { account: account.trim(), password, devicePublicKey },
    authenticated: false,
    retry: false,
    timeout: 70000,
  });
  if (revision !== loginRequestRevision) {
    throw new ApiClientError({
      code: "STALE_LOGIN",
      message: "登录请求已经取消。",
      statusCode: 0,
    });
  }
  const session = saveSession(data);
  syncHeartbeatSession();
  void synchronizeCompanionPreferences(
    data.user.account,
    data.user.companion,
  ).catch(() => undefined);
  return session;
}

export async function getCurrentUser(): Promise<CurrentUserData> {
  const lease = captureSessionLease();
  const data = await apiRequest<CurrentUserData>("/auth/me");
  assertSessionLeaseCurrent(lease);
  data.companion = await synchronizeCompanionPreferences(
    data.account,
    data.companion,
  );
  assertSessionLeaseCurrent(lease);
  saveCurrentUser(data);
  updateSessionCredential(data.credential);
  return data;
}

export async function getCredentialStatus(): Promise<CredentialState> {
  const lease = captureSessionLease();
  const data = await apiRequest<CredentialState>("/auth/status", {
    retry: false,
  });
  assertSessionLeaseCurrent(lease);
  updateSessionCredential(data);
  return data;
}

export async function logout(): Promise<void> {
  const lease = captureSessionLease();
  try {
    await apiRequest<{ loggedOut: true; dataRetained: true }>("/auth/logout", {
      method: "POST",
      data: {},
      retry: false,
      allowInvalidCredential: true,
    });
  } finally {
    if (lease) {
      clearSessionIfCurrent(lease);
    } else {
      clearSession();
    }
    syncHeartbeatSession();
  }
}
