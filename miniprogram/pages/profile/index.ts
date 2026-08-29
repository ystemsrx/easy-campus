import { APP_NAME } from "../../config/app";
import { logout as logoutSession } from "../../services/auth";
import { getPendingAutoDormCheckStatus } from "../../services/auto-dorm-check";
import { submitFeedback } from "../../services/feedback";
import { getPreloadedCurrentUser } from "../../services/primary-tab-preload";
import {
  getErrorMessage,
  isFeedbackDailyLimitError,
} from "../../services/request";
import type { PetShapeId } from "../../components/geometric-pet/engine-data";
import { loadPetPreferences, shouldShowPet } from "../../store/pet";
import {
  loadAutoDormCheckSnapshot,
  type AutoDormCheckSnapshot,
} from "../../store/auto-dorm-check";
import {
  captureSessionLease,
  getSession,
  isSessionLeaseCurrent,
  loadCurrentUser,
  sessionLeaseKey,
} from "../../store/session";
import { loadPreferences } from "../../store/preferences";
import type {
  AutoDormCheckState,
  CurrentUserData,
  FeedbackType,
} from "../../types/api";
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
  singleSelectionOptions,
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
  | "auto-dorm-check"
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
const FEEDBACK_TYPES: Array<{ value: FeedbackType; label: string }> = [
  { value: "bug", label: "问题反馈" },
  { value: "feature", label: "功能建议" },
  { value: "experience", label: "使用体验" },
  { value: "other", label: "其他" },
];

function feedbackTypeOptions(selected: FeedbackType | "" = "") {
  return singleSelectionOptions(FEEDBACK_TYPES, selected);
}

const AUTO_DORM_CHECK_STATUS: Record<
  AutoDormCheckState,
  { label: string; tone: "success" | "warning" | "danger" | "muted" }
> = {
  checked_in: { label: "已打卡", tone: "success" },
  pending: { label: "待打卡", tone: "warning" },
  unavailable: { label: "不可用", tone: "danger" },
  disabled: { label: "已关闭", tone: "muted" },
};

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
    autoDormCheckVisible: false,
    autoDormCheckStatusLabel: "已关闭",
    autoDormCheckStatusTone: "muted" as
      "success" | "warning" | "danger" | "muted",
    feedbackVisible: false,
    feedbackTypes: feedbackTypeOptions(),
    feedbackType: "" as FeedbackType | "",
    feedbackContent: "",
    feedbackCharacterCount: 0,
    feedbackCanSubmit: false,
    feedbackSubmitting: false,
    feedbackErrorMessage: "",
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
    this.hydrateAutoDormCheckAvailability(sessionAccount);
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
        autoDormCheckVisible: false,
        autoDormCheckStatusLabel: "已关闭",
        autoDormCheckStatusTone: "muted",
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
    this.hydrateAutoDormCheckAvailability(account);
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
      hidden: this.data.feedbackVisible,
      themeClass: this.data.themeClass,
      motionClass: this.data.motionClass,
    });
  },
  applyUser(user: CurrentUserData) {
    const name = user.name || "同学";
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
  applyAutoDormCheckAvailability(
    status: Pick<AutoDormCheckSnapshot, "entryEnabled" | "checkInStatus">,
  ) {
    const presentation = AUTO_DORM_CHECK_STATUS[status.checkInStatus];
    this.setData({
      autoDormCheckVisible: status.entryEnabled,
      autoDormCheckStatusLabel: presentation.label,
      autoDormCheckStatusTone: presentation.tone,
    });
  },
  hydrateAutoDormCheckAvailability(account: string) {
    const cached = loadAutoDormCheckSnapshot(account);
    if (cached) this.applyAutoDormCheckAvailability(cached);
    const lease = captureSessionLease();
    if (!lease) return;
    const pending = getPendingAutoDormCheckStatus();
    if (!pending) return;
    void pending
      .then((status) => {
        if (isSessionLeaseCurrent(lease)) {
          this.applyAutoDormCheckAvailability(status);
        }
      })
      .catch(() => undefined);
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
  openAutoDormCheck() {
    this.openProfileRoute(
      "auto-dorm-check",
      "/features/pages/auto-dorm-check/index",
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
  openFeedback() {
    if (this.data.feedbackVisible) return;
    haptic("light");
    this.setFeedbackTabBarHidden(true);
    this.setData({
      feedbackVisible: true,
      feedbackTypes: feedbackTypeOptions(this.data.feedbackType),
      feedbackErrorMessage: "",
    });
  },
  closeFeedback() {
    if (this.data.feedbackSubmitting) return;
    this.setData({
      feedbackVisible: false,
      feedbackTypes: feedbackTypeOptions(),
      feedbackType: "",
      feedbackContent: "",
      feedbackCharacterCount: 0,
      feedbackCanSubmit: false,
      feedbackErrorMessage: "",
    });
    this.setFeedbackTabBarHidden(false);
  },
  selectFeedbackType(event: WechatMiniprogram.TouchEvent) {
    const type = String(event.currentTarget.dataset.type || "") as FeedbackType;
    if (!FEEDBACK_TYPES.some((item) => item.value === type)) return;
    haptic("light");
    const feedbackType = this.data.feedbackType === type ? "" : type;
    this.setData({
      feedbackTypes: feedbackTypeOptions(feedbackType),
      feedbackType,
      feedbackCanSubmit: Boolean(
        feedbackType && this.data.feedbackContent.trim(),
      ),
      feedbackErrorMessage: "",
    });
  },
  onFeedbackContentInput(event: WechatMiniprogram.Input) {
    const feedbackContent = event.detail.value.slice(0, 500);
    this.setData({
      feedbackContent,
      feedbackCharacterCount: feedbackContent.length,
      feedbackCanSubmit: Boolean(
        this.data.feedbackType && feedbackContent.trim(),
      ),
      feedbackErrorMessage: "",
    });
  },
  async submitFeedback() {
    if (this.data.feedbackSubmitting) return;
    const lease = captureSessionLease();
    const type = this.data.feedbackType;
    const content = this.data.feedbackContent.trim();
    if (!lease) return;
    if (!type) {
      this.setData({ feedbackErrorMessage: "请选择类型" });
      return;
    }
    if (!content) {
      this.setData({ feedbackErrorMessage: "请填写具体内容" });
      return;
    }
    haptic("heavy");
    this.setData({ feedbackSubmitting: true, feedbackErrorMessage: "" });
    try {
      await submitFeedback({ type, content });
      if (!isSessionLeaseCurrent(lease)) return;
      this.setData({
        feedbackVisible: false,
        feedbackTypes: feedbackTypeOptions(),
        feedbackType: "",
        feedbackContent: "",
        feedbackCharacterCount: 0,
        feedbackCanSubmit: false,
        feedbackSubmitting: false,
      });
      this.setFeedbackTabBarHidden(false);
      wx.showToast({ title: "感谢你的反馈", icon: "success" });
    } catch (error) {
      if (!isSessionLeaseCurrent(lease)) return;
      if (isFeedbackDailyLimitError(error)) {
        this.setData({
          feedbackVisible: false,
          feedbackTypes: feedbackTypeOptions(),
          feedbackType: "",
          feedbackContent: "",
          feedbackCharacterCount: 0,
          feedbackCanSubmit: false,
          feedbackSubmitting: false,
          feedbackErrorMessage: "",
        });
        this.setFeedbackTabBarHidden(false);
        return;
      }
      this.setData({
        feedbackSubmitting: false,
        feedbackErrorMessage: getErrorMessage(error, "提交失败，请稍后重试。"),
      });
    }
  },
  setFeedbackTabBarHidden(hidden: boolean) {
    const tabBar = this.getTabBar();
    if (tabBar) tabBar.setData({ hidden });
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
