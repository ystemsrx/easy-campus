import type { LoginData, Session } from "../types/api";

export const DEMO_ACCOUNT = "demo";
export const DEMO_PASSWORD = "123456";

export function isDemoAccount(account?: string): boolean {
  return account?.trim() === DEMO_ACCOUNT;
}

export function isDemoSession(session: Session | null): boolean {
  return isDemoAccount(session?.user.account);
}

/** A local preview identity; this token is never a server credential. */
export function demoLoginData(): LoginData {
  return {
    token: `demo-local:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    tokenType: "Bearer",
    expiresIn: 7776000,
    sliding: true,
    loginMode: "local",
    credential: {
      status: "verified",
      checkedAt: new Date().toISOString(),
      errorCode: null,
    },
    device: null,
    user: {
      id: "demo-local",
      account: DEMO_ACCOUNT,
      name: "同学",
      companion: null,
    },
  };
}
