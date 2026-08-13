import { apiRequest } from "./request";
import { saveCurrentUser, saveSession } from "../store/session";
import type { CurrentUserData, LoginData, Session } from "../types/api";

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
  return data;
}
