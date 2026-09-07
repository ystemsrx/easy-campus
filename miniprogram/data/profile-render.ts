import {
  getPetPreferencesRevision,
  loadPetPreferences,
  shouldShowPet,
} from "../store/pet";
import {
  getAutoDormCheckRevision,
  loadAutoDormCheckSnapshot,
  type AutoDormCheckSnapshot,
} from "../store/auto-dorm-check";
import {
  getSessionRevision,
  getSession,
  loadCurrentUser,
} from "../store/session";
import { getPreferencesRevision, loadPreferences } from "../store/preferences";
import type {
  AutoDormCheckState,
  AutoDormCheckStatus,
  CurrentUserData,
} from "../types/api";
import { resolveAppearance } from "../utils/appearance";
import { identityCardTone, type IdentityCardTone } from "../utils/profile";

function classLabel(user: CurrentUserData): string {
  const grade = (user.profile.grade || "").trim().replace(/级$/, "");
  const className = (user.profile.className || "").trim();
  if (!className) return "";
  return grade && !className.includes(grade)
    ? `${grade}${className}`
    : className;
}

function enrollmentDateLabel(value?: string): string {
  return /^(\d{4}-\d{2}-\d{2})/.exec((value || "").trim())?.[1] || "";
}

const AUTO_DORM_CHECK_STATUS: Record<
  AutoDormCheckState,
  { label: string; tone: "success" | "warning" | "danger" | "muted" }
> = {
  checked_in: { label: "已打卡", tone: "success" },
  pending: { label: "待打卡", tone: "warning" },
  skipped: { label: "已跳过", tone: "muted" },
  failed: { label: "已失败", tone: "danger" },
  unavailable: { label: "不可用", tone: "danger" },
  disabled: { label: "已关闭", tone: "muted" },
  agreement_required: { label: "待同意", tone: "warning" },
  payment_required: { label: "额度不足", tone: "warning" },
};

export interface ProfileSourceRevisions {
  account: string;
  preferences: number;
  session: number;
  pet: number;
  autoDormCheck: number;
}

type ProfileSourceName = Exclude<keyof ProfileSourceRevisions, "account">;

export const PROFILE_SOURCE_NAMES: readonly ProfileSourceName[] = [
  "preferences",
  "session",
  "pet",
  "autoDormCheck",
];

export function readProfileSourceRevisions(
  account: string,
): ProfileSourceRevisions {
  return {
    account,
    preferences: getPreferencesRevision(),
    session: getSessionRevision(),
    pet: getPetPreferencesRevision(),
    autoDormCheck: getAutoDormCheckRevision(),
  };
}

export function autoDormCheckSettingTitle(
  status: Pick<
    AutoDormCheckSnapshot,
    "paymentEnabled" | "remainingDays" | "remainingUses"
  >,
): string {
  if (status.paymentEnabled === false) return "自动查寝（限免）";
  if (status.paymentEnabled !== true) return "自动查寝";
  if (status.remainingDays > 0) {
    return `自动查寝（${status.remainingDays}天）`;
  }
  if (status.remainingUses > 0) {
    return `自动查寝（${status.remainingUses}次）`;
  }
  return "自动查寝";
}

export function profileUserPatch(user: CurrentUserData | null) {
  const name = user?.name || "同学";
  return {
    userName: name,
    avatarText: user ? name.slice(0, 1) : "易",
    account: user?.account || "",
    organizationName: user?.profile.organizationName || "西南大学",
    classLabel: user ? classLabel(user) : "",
    enrollmentDate: user
      ? enrollmentDateLabel(user.profile.enrollmentDate)
      : "",
    identityCardTone: user
      ? identityCardTone(user.profile.gender)
      : ("neutral" as IdentityCardTone),
  };
}

export function autoDormCheckPresentationPatch(
  status:
    | Pick<
        AutoDormCheckSnapshot,
        | "entryEnabled"
        | "checkInStatus"
        | "paymentEnabled"
        | "remainingDays"
        | "remainingUses"
      >
    | AutoDormCheckStatus
    | null,
) {
  if (!status) {
    return {
      autoDormCheckVisible: false,
      autoDormCheckTitle: "自动查寝",
      autoDormCheckStatusLabel: "已关闭",
      autoDormCheckStatusTone: "muted" as const,
    };
  }
  const presentation = AUTO_DORM_CHECK_STATUS[status.checkInStatus];
  const quota =
    "remainingDays" in status
      ? status
      : {
          paymentEnabled: status.paymentEnabled,
          remainingDays: Math.max(
            0,
            Math.floor(Number(status.entitlement.time.remainingDays) || 0),
          ),
          remainingUses: Math.max(
            0,
            Math.floor(Number(status.entitlement.uses.remaining) || 0),
          ),
        };
  return {
    autoDormCheckVisible: status.entryEnabled,
    autoDormCheckTitle: autoDormCheckSettingTitle(quota),
    autoDormCheckStatusLabel: presentation.label,
    autoDormCheckStatusTone: presentation.tone,
  };
}

function cachedProfileRenderState(account: string) {
  const preferences = loadPreferences();
  const appearance = resolveAppearance(preferences);
  const pet = loadPetPreferences(account);
  const cachedUser = getApp<IAppOption>().globalData.user || loadCurrentUser();
  const user = cachedUser?.account === account ? cachedUser : null;
  return {
    appearance,
    sourceRevisions: readProfileSourceRevisions(account),
    patch: {
      ...appearance,
      reducedMotion: preferences.reducedMotion,
      ...profileUserPatch(user),
      petShape: pet.shape,
      petColor: pet.color,
      petEnhanced: pet.enhanced,
      petSelected: pet.selected,
      petEnabled: pet.enabled,
      petVisible: shouldShowPet(pet),
      ...autoDormCheckPresentationPatch(loadAutoDormCheckSnapshot(account)),
      errorMessage: "",
    },
  };
}

let prewarmedProfile: ReturnType<typeof cachedProfileRenderState> | null = null;

export function getPrewarmedProfileFirstScreen(account: string) {
  const cached = prewarmedProfile;
  if (
    !cached ||
    getSession()?.user.account !== account ||
    cached.sourceRevisions.account !== account
  )
    return null;
  const current = readProfileSourceRevisions(account);
  if (
    PROFILE_SOURCE_NAMES.some(
      (source) => current[source] !== cached.sourceRevisions[source],
    )
  )
    return null;
  // System appearance can change without a preferences-store revision.
  if (resolveAppearance(loadPreferences()).theme !== cached.appearance.theme)
    return null;
  return cached;
}

/** Prepare display values without creating or navigating to a Page. */
export function prewarmProfileFirstScreen(account: string) {
  const cached = getPrewarmedProfileFirstScreen(account);
  if (cached) return cached;
  prewarmedProfile = cachedProfileRenderState(account);
  return prewarmedProfile;
}
