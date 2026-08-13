import { apiRequest } from "./request";
import {
  clearSession,
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

export async function login(
  account: string,
  password: string,
): Promise<Session> {
  const data = await apiRequest<LoginData>("/auth/login", {
    method: "POST",
    data: { account: account.trim(), password },
    authenticated: false,
    retry: false,
    timeout: 70000,
  });
  return saveSession(data);
}

export async function getCurrentUser(): Promise<CurrentUserData> {
  const data = await apiRequest<CurrentUserData>("/auth/me");
  saveCurrentUser(data);
  updateSessionCredential(data.credential);
  return data;
}

export async function getCredentialStatus(): Promise<CredentialState> {
  const data = await apiRequest<CredentialState>("/auth/status", {
    retry: false,
  });
  updateSessionCredential(data);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await apiRequest<{ loggedOut: true; dataRetained: true }>("/auth/logout", {
      method: "POST",
      data: {},
      retry: false,
    });
  } finally {
    clearSession();
  }
}
