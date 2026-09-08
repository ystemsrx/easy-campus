import { buildAppShare } from "../../utils/app-share";
import {
  autoDormCheckPresentationPatch,
  getPrewarmedProfileFirstScreen,
  prewarmProfileFirstScreen,
  profileUserPatch,
  PROFILE_SOURCE_NAMES,
  readProfileSourceRevisions,
  type ProfileSourceRevisions,
} from "../../data/profile-render";
import { APP_NAME } from "../../config/app";
import { logout as logoutSession } from "../../services/auth";
import { getPendingAutoDormCheckStatus } from "../../services/auto-dorm-check";
import { submitFeedback } from "../../services/feedback";
import {
  loadInteractionDraft,
  saveInteractionDraft,
  clearInteractionDraft,
} from "../../store/interaction-drafts";
import { getPreloadedCurrentUser } from "../../services/primary-tab-preload";
import {
  getErrorMessage,
  isFeedbackDailyLimitError,
} from "../../services/request";
import type { PetShapeId } from "../../components/geometric-pet/engine-data";
import type { AutoDormCheckSnapshot } from "../../store/auto-dorm-check";
import {
  captureSessionLease,
  getSession,
  isSessionLeaseCurrent,
} from "../../store/session";
import { loadPreferences } from "../../store/preferences";
import type {
  AutoDormCheckStatus,
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
  singleSelectionOptions,
  type IdentityCardTone,
} from "../../utils/profile";

type ProfileSettingKey =
  | "course-assistant"
  | "auto-dorm-check"
  | "pet"
  | "grades"
  | "personalization"
  | "about"
  | "terms"
  | "privacy";

const INITIAL_PROFILE_PREFERENCES = loadPreferences();
const INITIAL_PROFILE_APPEARANCE = resolveAppearance(
  INITIAL_PROFILE_PREFERENCES,
);
const PROFILE_AUTH_EXIT_MS = 180;
const PROFILE_RETURN_REFRESH_DELAY_MS = 520;
const FEEDBACK_TYPES: Array<{ value: FeedbackType; label: string }> = [
  { value: "bug", label: "问题反馈" },
  { value: "feature", label: "功能建议" },
  { value: "experience", label: "使用体验" },
  { value: "other", label: "其他" },
];

function feedbackTypeOptions(selected: FeedbackType | "" = "") {
  return singleSelectionOptions(FEEDBACK_TYPES, selected);
}

type ProfileSourceName = Exclude<keyof ProfileSourceRevisions, "account">;

let authenticationExitTimer: ReturnType<typeof setTimeout> | undefined;
let hydratedProfileSources: ProfileSourceRevisions | null = null;
let profileRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let profileVisible = false;

function profileSourcesAreCurrent(account: string): boolean {
  if (!hydratedProfileSources || hydratedProfileSources.account !== account) {
    return false;
  }
  const current = readProfileSourceRevisions(account);
  return PROFILE_SOURCE_NAMES.every(
    (source) => current[source] === hydratedProfileSources?.[source],
  );
}

function markProfileSourcesHydrated(
  account: string,
  sources: readonly ProfileSourceName[],
): void {
  if (!hydratedProfileSources || hydratedProfileSources.account !== account) {
    return;
  }
  const current = readProfileSourceRevisions(account);
  const next = { ...hydratedProfileSources };
  for (const source of sources) next[source] = current[source];
  hydratedProfileSources = next;
}

function clearProfileRefreshTimer(): void {
  if (profileRefreshTimer === undefined) return;
  clearTimeout(profileRefreshTimer);
  profileRefreshTimer = undefined;
}

function clearAuthenticationExitTimer(): void {
  if (authenticationExitTimer === undefined) return;
  clearTimeout(authenticationExitTimer);
  authenticationExitTimer = undefined;
}

Page({
  onShareAppMessage: buildAppShare,
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
    autoDormCheckTitle: "自动查寝",
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
    hydratedProfileSources = null;
    profileVisible = false;
    const sessionAccount = getSession()?.user.account || "";
    if (sessionAccount) {
      this.hydrateCachedProfileIfNeeded(sessionAccount, true);
    }
  },
  onShow() {
    if (!ensureAuthenticated()) {
      return;
    }
    clearAuthenticationExitTimer();
    profileVisible = true;
    const lease = captureSessionLease();
    if (!lease) return;
    const account = lease.account;
    if (this.data.account && this.data.account !== account)
      this.setData({
        feedbackVisible: false,
        feedbackSubmitting: false,
        feedbackContent: "",
        feedbackType: "",
        feedbackCanSubmit: false,
      });
    const hydrated = this.hydrateCachedProfileIfNeeded(account);
    if (
      !hydrated &&
      (this.data.loggingOut ||
        this.data.openingSetting ||
        this.data.authenticationExitClass)
    ) {
      this.setData({
        loggingOut: false,
        openingSetting: "",
        authenticationExitClass: "",
      });
    }
    this.syncTabBarAppearance();
    this.scheduleProfileRefresh(PROFILE_RETURN_REFRESH_DELAY_MS);
  },
  onHide() {
    profileVisible = false;
    clearProfileRefreshTimer();
  },
  onUnload() {
    profileVisible = false;
    clearProfileRefreshTimer();
    clearAuthenticationExitTimer();
  },
  hydrateCachedProfileIfNeeded(account: string, force = false): boolean {
    if (!force && profileSourcesAreCurrent(account)) return false;
    const state =
      getPrewarmedProfileFirstScreen(account) ||
      prewarmProfileFirstScreen(account);
    hydratedProfileSources = state.sourceRevisions;
    const appearance = state.appearance;
    syncWindowBackground(appearance);
    this.setData({
      ...state.patch,
      loading: false,
      loggingOut: false,
      openingSetting: "",
      authenticationExitClass: "",
    });
    return true;
  },
  scheduleProfileRefresh(delay: number) {
    clearProfileRefreshTimer();
    profileRefreshTimer = setTimeout(() => {
      profileRefreshTimer = undefined;
      if (!profileVisible) return;
      void this.loadUser();
      this.hydrateAutoDormCheckAvailability();
    }, delay);
  },
  syncTabBarAppearance() {
    this.getTabBar().setData({
      selected: 2,
      hidden: this.data.feedbackVisible,
      themeClass: this.data.themeClass,
      visualThemeClass: this.data.visualThemeClass,
      motionClass: this.data.motionClass,
    });
  },
  applyUser(user: CurrentUserData) {
    this.setData(profileUserPatch(user), () => {
      markProfileSourcesHydrated(user.account, ["session"]);
    });
  },
  async loadUser(refresh = false) {
    if (this.data.loading) {
      return;
    }
    const lease = captureSessionLease();
    if (!lease) return;
    if (!this.data.account || this.data.errorMessage) {
      this.setData({
        loading: !this.data.account,
        errorMessage: "",
      });
    }
    try {
      const user = await getPreloadedCurrentUser(refresh);
      if (user && profileVisible && isSessionLeaseCurrent(lease)) {
        this.applyUser(user);
      }
    } catch (error) {
      if (profileVisible && isSessionLeaseCurrent(lease)) {
        this.setData({
          errorMessage: getErrorMessage(error, "个人资料加载失败。"),
        });
      }
    } finally {
      if (profileVisible && this.data.loading && isSessionLeaseCurrent(lease)) {
        this.setData({ loading: false });
      }
    }
  },
  retryLoadUser() {
    haptic("light");
    void this.loadUser(true);
  },
  applyAutoDormCheckAvailability(
    status:
      | Pick<
          AutoDormCheckSnapshot,
          | "entryEnabled"
          | "checkInStatus"
          | "paymentEnabled"
          | "remainingDays"
          | "remainingUses"
        >
      | AutoDormCheckStatus,
  ) {
    this.setData(autoDormCheckPresentationPatch(status), () => {
      const account = getSession()?.user.account || "";
      if (account) markProfileSourcesHydrated(account, ["autoDormCheck"]);
    });
  },
  hydrateAutoDormCheckAvailability() {
    const lease = captureSessionLease();
    if (!lease) return;
    const pending = getPendingAutoDormCheckStatus();
    if (!pending) return;
    void pending
      .then((status) => {
        if (profileVisible && isSessionLeaseCurrent(lease)) {
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
  openAbout() {
    this.openProfileRoute("about", "/features/pages/about/index");
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
    const account = getSession()?.user.account || "";
    const draft = loadInteractionDraft(account, "feedback");
    const type = FEEDBACK_TYPES.some((item) => item.value === draft?.type)
      ? draft!.type
      : "";
    const content = draft?.content || "";
    haptic("light");
    this.setFeedbackTabBarHidden(true);
    this.setData({
      feedbackVisible: true,
      feedbackTypes: feedbackTypeOptions(type),
      feedbackType: type,
      feedbackContent: content,
      feedbackCharacterCount: content.length,
      feedbackCanSubmit: Boolean(type && content.trim()),
      feedbackErrorMessage: "",
    });
  },
  closeFeedback() {
    if (this.data.feedbackSubmitting) return;
    this.setData({
      feedbackVisible: false,
      feedbackErrorMessage: "",
    });
    this.setFeedbackTabBarHidden(false);
  },
  saveFeedbackDraft() {
    if (getSession()?.user.account !== this.data.account) return;
    saveInteractionDraft(this.data.account, "feedback", {
      type: this.data.feedbackType,
      content: this.data.feedbackContent,
    });
  },
  selectFeedbackType(event: WechatMiniprogram.TouchEvent) {
    if (this.data.feedbackSubmitting) return;
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
    this.saveFeedbackDraft();
  },
  onFeedbackContentInput(event: WechatMiniprogram.Input) {
    if (this.data.feedbackSubmitting) return;
    const feedbackContent = event.detail.value.slice(0, 500);
    this.setData({
      feedbackContent,
      feedbackCharacterCount: feedbackContent.length,
      feedbackCanSubmit: Boolean(
        this.data.feedbackType && feedbackContent.trim(),
      ),
      feedbackErrorMessage: "",
    });
    this.saveFeedbackDraft();
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
      clearInteractionDraft(lease.account, "feedback");
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
