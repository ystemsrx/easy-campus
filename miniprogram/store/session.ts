import type { CurrentUserData, LoginData, Session } from "../types/api";

const SESSION_KEY = "easy-swu:session";
const USER_KEY = "easy-swu:user";

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Session>;
  return (
    typeof candidate.token === "string" &&
    candidate.token.length > 0 &&
    candidate.tokenType === "Bearer" &&
    candidate.sliding === true &&
    typeof candidate.user?.id === "string" &&
    typeof candidate.user.account === "string" &&
    typeof candidate.user.name === "string"
  );
}

export function loadSession(): Session | null {
  const stored = wx.getStorageSync(SESSION_KEY) as unknown;
  if (!isSession(stored)) {
    if (stored) {
      wx.removeStorageSync(SESSION_KEY);
    }
    return null;
  }

  return stored;
}

export function saveSession(loginData: LoginData): Session {
  const session: Session = {
    ...loginData,
    signedInAt: Date.now(),
  };
  wx.setStorageSync(SESSION_KEY, session);
  getApp<IAppOption>().globalData.session = session;
  return session;
}

export function getSession(): Session | null {
  const app = getApp<IAppOption>();
  return app.globalData.session || loadSession();
}

export function saveCurrentUser(user: CurrentUserData): void {
  wx.setStorageSync(USER_KEY, user);
  getApp<IAppOption>().globalData.user = user;
}

export function loadCurrentUser(): CurrentUserData | null {
  const user = wx.getStorageSync(USER_KEY) as CurrentUserData | undefined;
  return user && typeof user.id === "string" ? user : null;
}

export function clearSession(): void {
  wx.removeStorageSync(SESSION_KEY);
  wx.removeStorageSync(USER_KEY);
  const app = getApp<IAppOption>();
  app.globalData.session = null;
  app.globalData.user = null;
  app.globalData.selectedGrade = null;
}

export function isAuthenticated(): boolean {
  return Boolean(getSession()?.token);
}
