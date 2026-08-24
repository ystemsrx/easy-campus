import { APP_NAME } from "../../config/app";
import { logout as logoutSession } from "../../services/auth";
import { getPreloadedCurrentUser } from "../../services/primary-tab-preload";
import { getErrorMessage } from "../../services/request";
import type { PetShapeId } from "../../components/geometric-pet/engine-data";
import { loadPetPreferences, shouldShowPet } from "../../store/pet";
import {
  captureSessionLease,
  getSession,
  isSessionLeaseCurrent,
  loadCurrentUser,
  sessionLeaseKey,
} from "../../store/session";
import { loadPreferences } from "../../store/preferences";
import type { CurrentUserData } from "../../types/api";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../utils/appearance";
import { haptic } from "../../utils/haptics";
import {
  ensureAuthenticated,
  goToLogin,
  navigateTo,
} from "../../utils/navigation";
import {
  identityCardTone,
  type IdentityCardTone,
} from "../../utils/profile";

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

type ProfileSettingKey =
  | "course-assistant"
  | "pet"
  | "grades"
  | "personalization"
  | "terms"
  | "privacy";

const INITIAL_PROFILE_PREFERENCES = loadPreferences();
const INITIAL_PROFILE_APPEARANCE = resolveAppearance(
  INITIAL_PROFILE_PREFERENCES,
);
const PROFILE_AUTH_EXIT_MS = 180;

let authenticationExitTimer: ReturnType<typeof setTimeout> | undefined;
let activeProfileSessionKey = "";

function clearAuthenticationExitTimer(): void {
  if (authenticationExitTimer === undefined) return;
  clearTimeout(authenticationExitTimer);
  authenticationExitTimer = undefined;
}

Page({
  data: {
    ...INITIAL_PROFILE_APPEARANCE,
    appName: APP_NAME,
    loading: false,
    loggingOut: false,
    openingSetting: "" as ProfileSettingKey | "",
    authenticationExitClass: "",
    errorMessage: "",
    userName: "同学",
    avatarText: "易",
    account: "",
    organizationName: "西南大学",
    classLabel: "",
    enrollmentDate: "",
    identityCardTone: "neutral" as IdentityCardTone,
    reducedMotion: INITIAL_PROFILE_PREFERENCES.reducedMotion,
    petShape: "blob" as PetShapeId,
    petColor: "#111214",
    petEnhanced: false,
    petSelected: false,
    petEnabled: false,
    petVisible: false,
  },
  onLoad() {
    activeProfileSessionKey = "";
    this.applyAppearance();
    const sessionAccount = getSession()?.user.account || "";
    const cached = getApp<IAppOption>().globalData.user || loadCurrentUser();
    if (cached?.account === sessionAccount) {
      this.applyUser(cached);
      this.loadPet(cached.account);
    }
  },
  onShow() {
    if (!ensureAuthenticated()) {
      return;
    }
    clearAuthenticationExitTimer();
    const lease = captureSessionLease();
    if (!lease) return;
    const account = lease.account;
    const sessionKey = sessionLeaseKey(lease);
    if (
      (activeProfileSessionKey && activeProfileSessionKey !== sessionKey) ||
      (this.data.account && this.data.account !== account)
    ) {
      this.setData({
        loading: false,
        userName: "同学",
        avatarText: "易",
        account: "",
        organizationName: "西南大学",
        classLabel: "",
        enrollmentDate: "",
        identityCardTone: "neutral",
        errorMessage: "",
      });
    }
    activeProfileSessionKey = sessionKey;
    this.setData({
      loggingOut: false,
      openingSetting: "",
      authenticationExitClass: "",
    });
    this.applyAppearance();
    this.loadPet(account);
    this.syncTabBarAppearance();
    void this.loadUser();
  },
  onUnload() {
    clearAuthenticationExitTimer();
  },
  applyAppearance() {
    const preferences = getApp<IAppOption>().globalData.preferences;
    const appearance = resolveAppearance(preferences);
    syncWindowBackground(appearance.theme);
    this.setData({
      ...appearance,
      reducedMotion: preferences.reducedMotion,
    });
  },
  syncTabBarAppearance() {
    this.getTabBar().setData({
      selected: 2,
      themeClass: this.data.themeClass,
      motionClass: this.data.motionClass,
    });
  },
  applyUser(user: CurrentUserData) {
    const name = user.name || user.profile.name || "同学";
    this.setData({
      userName: name,
      avatarText: name.slice(0, 1),
      account: user.account,
      organizationName: user.profile.organizationName || "西南大学",
      classLabel: classLabel(user),
      enrollmentDate: enrollmentDateLabel(user.profile.enrollmentDate),
      identityCardTone: identityCardTone(user.profile.gender),
    });
  },
  loadPet(account: string) {
    if (!account) return;
    const preferences = loadPetPreferences(account);
    this.setData({
      petShape: preferences.shape,
      petColor: preferences.color,
      petEnhanced: preferences.enhanced,
      petSelected: preferences.selected,
      petEnabled: preferences.enabled,
      petVisible: shouldShowPet(preferences),
    });
  },
  async loadUser(refresh = false) {
    if (this.data.loading) {
      return;
    }
    const lease = captureSessionLease();
    if (!lease) return;
    this.setData({
      loading: !this.data.account,
      errorMessage: "",
    });
    try {
      const user = await getPreloadedCurrentUser(refresh);
      if (user && isSessionLeaseCurrent(lease)) this.applyUser(user);
    } catch (error) {
      if (isSessionLeaseCurrent(lease)) {
        this.setData({
          errorMessage: getErrorMessage(error, "个人资料加载失败。"),
        });
      }
    } finally {
      if (isSessionLeaseCurrent(lease)) this.setData({ loading: false });
    }
  },
  retryLoadUser() {
    haptic("light");
    void this.loadUser(true);
  },
  openProfileRoute(key: ProfileSettingKey, url: string) {
    if (this.data.openingSetting) return;
    haptic("light");
    this.setData({ openingSetting: key }, () => {
      void navigateTo(url).then((opened) => {
        if (opened || this.data.openingSetting !== key) return;
        this.setData({ openingSetting: "" });
      });
    });
  },
  openCourseAssistant() {
    this.openProfileRoute(
      "course-assistant",
      "/features/pages/course-assistant/index",
    );
  },
  openPetSetup() {
    this.openProfileRoute(
      "pet",
      "/features/pages/pet-setup/index?source=profile",
    );
  },
  openGradeDisplaySettings() {
    this.openProfileRoute("grades", "/features/pages/grade-settings/index");
  },
  openPersonalizationSettings() {
    this.openProfileRoute(
      "personalization",
      "/features/pages/personalization/index",
    );
  },
  openLegalDocument(event: WechatMiniprogram.TouchEvent) {
    const document =
      String(event.currentTarget.dataset.document) === "privacy"
        ? "privacy"
        : "terms";
    this.openProfileRoute(document, `/pages/legal/index?document=${document}`);
  },
  prepareForAuthenticationRequired(onReady?: () => void) {
    clearAuthenticationExitTimer();
    const tabBar = this.getTabBar();
    if (tabBar) tabBar.setData({ hidden: true });
    this.setData({ authenticationExitClass: "profile-page--leaving" }, () => {
      if (this.data.motionClass === "motion-reduced") {
        onReady?.();
        return;
      }
      authenticationExitTimer = setTimeout(() => {
        authenticationExitTimer = undefined;
        onReady?.();
      }, PROFILE_AUTH_EXIT_MS);
    });
  },
  logout() {
    if (this.data.loggingOut) return;
    const lease = captureSessionLease();
    haptic("heavy");
    this.setData({ loggingOut: true });
    void logoutSession()
      .catch(() => undefined)
      .finally(() => {
        if (!getSession() || isSessionLeaseCurrent(lease)) goToLogin();
      });
  },
});
