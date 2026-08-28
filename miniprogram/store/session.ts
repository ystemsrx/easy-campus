import type { CurrentUserData, LoginData, Session } from "../types/api";

const SESSION_KEY = "easy-swu:session";
const USER_KEY = "easy-swu:user";
const SESSION_INVALID_NOTICE_KEY = "easy-swu:session-invalid-notice";
const ACCOUNT_DEACTIVATED_NOTICE_KEY = "easy-swu:account-deactivated-notice";
const SESSION_INVALID_NOTICE_TTL_MS = 15_000;
const CURRENT_USER_PROFILE_FIELDS = [
  "gender",
  "grade",
  "organizationName",
  "className",
  "enrollmentDate",
] as const;

export interface SessionLease {
  token: string;
  userId: string;
  account: string;
  signedInAt: number;
}

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

  const credential = stored.credential;
  const normalized: Session = {
    ...stored,
    loginMode: stored.loginMode === "local" ? "local" : "campus",
    credential:
      credential &&
      ["verified", "pending", "invalid", "unavailable"].includes(
        credential.status,
      )
        ? credential
        : { status: "verified", checkedAt: null, errorCode: null },
  };
  wx.setStorageSync(SESSION_KEY, normalized);
  return normalized;
}

export function saveSession(loginData: LoginData): Session {
  const previousAccount =
    getSession()?.user.account || loadCurrentUser()?.account || "";
  const session: Session = {
    ...loginData,
    signedInAt: Date.now(),
  };
  wx.setStorageSync(SESSION_KEY, session);
  wx.removeStorageSync(SESSION_INVALID_NOTICE_KEY);
  wx.removeStorageSync(ACCOUNT_DEACTIVATED_NOTICE_KEY);
  const app = getApp<IAppOption>();
  if (previousAccount && previousAccount !== session.user.account) {
    wx.removeStorageSync(USER_KEY);
    app.globalData.user = null;
    app.globalData.selectedGrade = null;
  }
  app.globalData.session = session;
  return session;
}

export function updateSessionCredential(
  credential: Session["credential"],
): void {
  const session = getSession();
  if (!session) return;
  const updated = { ...session, credential };
  wx.setStorageSync(SESSION_KEY, updated);
  getApp<IAppOption>().globalData.session = updated;
}

export function getSession(): Session | null {
  try {
    const app = getApp<IAppOption>();
    return app?.globalData.session || loadSession();
  } catch {
    return loadSession();
  }
}

/**
 * 捕获一次登录会话的不可变身份。异步工作必须在写缓存或页面状态前校验它，
 * 避免旧账号请求在退出并登录新账号后污染新会话。
 */
export function captureSessionLease(
  session: Session | null = getSession(),
): SessionLease | null {
  if (!session) return null;
  return {
    token: session.token,
    userId: session.user.id,
    account: session.user.account,
    signedInAt: session.signedInAt,
  };
}

export function sessionLeaseKey(lease: SessionLease): string {
  return `${lease.userId}:${lease.account}:${lease.signedInAt}:${lease.token}`;
}

export function isSessionLeaseCurrent(
  lease: SessionLease | null,
  session: Session | null = getSession(),
): boolean {
  return Boolean(
    lease &&
    session &&
    lease.token === session.token &&
    lease.userId === session.user.id &&
    lease.account === session.user.account &&
    lease.signedInAt === session.signedInAt,
  );
}

export function assertSessionLeaseCurrent(
  lease: SessionLease | null,
): asserts lease is SessionLease {
  if (!isSessionLeaseCurrent(lease)) {
    throw new Error("登录账号已经切换。");
  }
}

export function saveCurrentUser(user: CurrentUserData): void {
  const sanitized = sanitizeCurrentUser(user);
  wx.setStorageSync(USER_KEY, sanitized);
  getApp<IAppOption>().globalData.user = sanitized;
}

export function loadCurrentUser(): CurrentUserData | null {
  const user = wx.getStorageSync(USER_KEY) as CurrentUserData | undefined;
  if (!user || typeof user.id !== "string") return null;
  const sanitized = sanitizeCurrentUser(user);
  wx.setStorageSync(USER_KEY, sanitized);
  return sanitized;
}

function sanitizeCurrentUser(user: CurrentUserData): CurrentUserData {
  const source = user.profile || {};
  const profile: CurrentUserData["profile"] = {};
  for (const field of CURRENT_USER_PROFILE_FIELDS) {
    const value = source[field];
    if (typeof value === "string" && value) profile[field] = value;
  }
  return {
    id: user.id,
    account: user.account,
    name: user.name,
    credential: user.credential,
    companion: user.companion ?? null,
    profile,
  };
}

export function clearSession(): void {
  wx.removeStorageSync(SESSION_KEY);
  wx.removeStorageSync(USER_KEY);
  const app = getApp<IAppOption>();
  app.globalData.session = null;
  app.globalData.user = null;
  app.globalData.selectedGrade = null;
}

/** 仅清理由发起方捕获的会话，不能让旧请求退出后来登录的新账号。 */
export function clearSessionIfCurrent(lease: SessionLease | null): boolean {
  if (!isSessionLeaseCurrent(lease)) return false;
  clearSession();
  return true;
}

export function queueSessionInvalidNotice(): void {
  try {
    wx.setStorageSync(SESSION_INVALID_NOTICE_KEY, Date.now());
  } catch {
    // 提示写入失败不应阻止清理会话和返回登录页。
  }
}

export function consumeSessionInvalidNotice(): boolean {
  try {
    const createdAt = Number(wx.getStorageSync(SESSION_INVALID_NOTICE_KEY));
    wx.removeStorageSync(SESSION_INVALID_NOTICE_KEY);
    return (
      Number.isFinite(createdAt) &&
      createdAt > 0 &&
      Date.now() - createdAt <= SESSION_INVALID_NOTICE_TTL_MS
    );
  } catch {
    return false;
  }
}

export function queueAccountDeactivatedNotice(): void {
  try {
    wx.removeStorageSync(SESSION_INVALID_NOTICE_KEY);
    wx.setStorageSync(ACCOUNT_DEACTIVATED_NOTICE_KEY, Date.now());
  } catch {
    // 提示写入失败不应阻止清理会话和返回登录页。
  }
}

export function consumeAccountDeactivatedNotice(): boolean {
  try {
    const createdAt = Number(wx.getStorageSync(ACCOUNT_DEACTIVATED_NOTICE_KEY));
    wx.removeStorageSync(ACCOUNT_DEACTIVATED_NOTICE_KEY);
    wx.removeStorageSync(SESSION_INVALID_NOTICE_KEY);
    return (
      Number.isFinite(createdAt) &&
      createdAt > 0 &&
      Date.now() - createdAt <= SESSION_INVALID_NOTICE_TTL_MS
    );
  } catch {
    return false;
  }
}

export function isAuthenticated(): boolean {
  return Boolean(getSession()?.token);
}
