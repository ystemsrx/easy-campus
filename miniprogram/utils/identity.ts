import type { CurrentUserData, Session } from "../types/api";

export interface HomeIdentity {
  userName: string;
  organizationName: string;
}

function identityText(value?: string): string {
  return (value || "").trim();
}

function isRealName(value: string): boolean {
  return Boolean(value) && value !== "同学";
}

export function resolveHomeIdentity(
  session: Session | null,
  currentUser: CurrentUserData | null,
): HomeIdentity {
  if (!session) {
    return { userName: "", organizationName: "" };
  }

  const user =
    currentUser?.account === session.user.account ? currentUser : null;
  const candidates = [
    identityText(user?.profile.name),
    identityText(user?.name),
    identityText(session.user.name),
  ];

  return {
    userName: candidates.find(isRealName) || identityText(session.user.account),
    organizationName:
      identityText(user?.profile.organizationName) || "西南大学",
  };
}
