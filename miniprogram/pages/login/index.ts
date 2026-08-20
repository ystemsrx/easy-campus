import { MINIPROGRAM_NAME } from "../../config/env";
import { login } from "../../services/auth";
import { refreshExamsAfterSignIn } from "../../services/cache-refresh";
import {
  getPreloadedCurrentUser,
  preloadPrimaryTabs,
} from "../../services/primary-tab-preload";
import { getErrorMessage } from "../../services/request";
import { loadPreferences } from "../../store/preferences";
import { isAuthenticated } from "../../store/session";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../utils/appearance";
import { haptic } from "../../utils/haptics";
import {
  CRABWALKING_LEG_MS,
  LAPTOP_DURATION_MS,
  LURKING_DURATION_MS,
  resolveLoginHandoffDelay,
  resolveWalkingPositionRpx,
  WAVING_DURATION_MS,
} from "./motion";

type MascotName =
  "laptop" | "magnifier" | "lurking" | "crabwalking" | "waving" | "dancing";
type MascotScheme = "laptop" | "lurking";

const INITIAL_LOGIN_APPEARANCE = resolveAppearance(loadPreferences());

const MASCOT_SOURCES: Record<MascotName, string> = {
  laptop: "/assets/login/laptop.gif",
  magnifier: "/assets/login/magnifier.gif",
  lurking: "/assets/login/lurking.gif",
  crabwalking: "/assets/login/crabwalking.gif",
  waving: "/assets/login/waving.gif",
  dancing: "/assets/login/dancing.gif",
};

const ERROR_TOAST_HOLD_MS = 3000;
const ERROR_TOAST_EXIT_MS = 320;

let mascotScheme: MascotScheme = "laptop";
let currentMascot: MascotName | "" = "";
let mascotSequenceTimer: ReturnType<typeof setTimeout> | undefined;
let errorToastTimer: ReturnType<typeof setTimeout> | undefined;
let errorToastCleanupTimer: ReturnType<typeof setTimeout> | undefined;
let laptopCycleStartedAt = 0;
let lurkingCycleStartedAt = 0;
let mascotAnimationStartedAt = 0;
let walkingLegStartedAt = 0;
let submitAnimationStartedAt = 0;
let inputAnimationStarted = false;
let mascotRevision = 0;
let pageActive = false;
let routingToHome = false;

function clearMascotSequenceTimer() {
  if (mascotSequenceTimer) {
    clearTimeout(mascotSequenceTimer);
    mascotSequenceTimer = undefined;
  }
}

function clearErrorToastTimers() {
  if (errorToastTimer) {
    clearTimeout(errorToastTimer);
    errorToastTimer = undefined;
  }
  if (errorToastCleanupTimer) {
    clearTimeout(errorToastCleanupTimer);
    errorToastCleanupTimer = undefined;
  }
}

function normalizeLoginErrorMessage(message: string): string {
  if (message.includes("西南大学账号或密码错误")) {
    return "账号或密码错误";
  }
  return message;
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function preloadHomeFramework(): void {
  if (typeof wx.preloadSkylineView !== "function") {
    return;
  }
  try {
    wx.preloadSkylineView();
  } catch {
    // 预加载失败不影响标准页面切换。
  }
}

function routeAfterAuthentication(onFailure?: () => void): void {
  wx.switchTab({
    url: "/pages/home/index",
    fail: () => onFailure?.(),
  });
}

Page({
  data: {
    appName: MINIPROGRAM_NAME,
    account: "",
    password: "",
    passwordVisible: false,
    agreementAccepted: false,
    accountFocused: false,
    passwordFocused: false,
    loading: false,
    errorMessage: "",
    errorToastPhase: "",
    mascotSrc: "",
    mascotPositionClass: "mascot-position--right",
    mascotPositionStyle: "",
    mascotMotionClass: "",
    ...INITIAL_LOGIN_APPEARANCE,
  },
  onLoad() {
    currentMascot = "";
    routingToHome = false;
    pageActive = true;
    inputAnimationStarted = false;
    mascotRevision = 0;
    clearMascotSequenceTimer();
    clearErrorToastTimers();
    this.applyAppearance();
    if (isAuthenticated()) {
      preloadHomeFramework();
      routingToHome = true;
      routeAfterAuthentication(() => {
        routingToHome = false;
        if (pageActive) {
          this.startInitialMascot();
        }
      });
      return;
    }

    this.startInitialMascot();
  },
  onShow() {
    this.applyAppearance();
  },
  onReady() {
    preloadHomeFramework();
  },
  onUnload() {
    pageActive = false;
    routingToHome = false;
    currentMascot = "";
    mascotRevision += 1;
    clearMascotSequenceTimer();
    clearErrorToastTimers();
  },
  applyAppearance() {
    const appearance = resolveAppearance();
    syncWindowBackground(appearance.theme);
    this.setData(appearance);
  },
  startInitialMascot() {
    mascotScheme = Math.random() < 0.5 ? "laptop" : "lurking";
    if (mascotScheme === "laptop") {
      laptopCycleStartedAt = Date.now();
      this.playMascot("laptop", "mascot-position--right");
      return;
    }

    this.playMascot("lurking", "mascot-position--left");
  },
  playMascot(
    mascot: MascotName,
    positionClass: string,
    motionClass = "",
    positionStyle = "",
  ) {
    clearMascotSequenceTimer();
    mascotRevision += 1;
    const revision = mascotRevision;
    mascotAnimationStartedAt = Date.now();
    if (mascot === "lurking") {
      lurkingCycleStartedAt = mascotAnimationStartedAt;
    }
    if (
      mascot === "crabwalking" &&
      motionClass === "mascot-motion--walk-leg"
    ) {
      walkingLegStartedAt = mascotAnimationStartedAt;
    }
    const shouldRestart = currentMascot === mascot;
    currentMascot = mascot;
    if (!shouldRestart) {
      this.setData({
        mascotSrc: MASCOT_SOURCES[mascot],
        mascotPositionClass: positionClass,
        mascotPositionStyle: positionStyle,
        mascotMotionClass: motionClass,
      });
      return;
    }
    this.setData(
      {
        mascotSrc: "",
        mascotPositionClass: positionClass,
        mascotPositionStyle: positionStyle,
        mascotMotionClass: motionClass,
      },
      () => {
        if (!pageActive || revision !== mascotRevision) {
          return;
        }
        this.setData({ mascotSrc: MASCOT_SOURCES[mascot] });
      },
    );
  },
  scheduleMascotTransition(delay: number, transition: () => void) {
    clearMascotSequenceTimer();
    mascotSequenceTimer = setTimeout(() => {
      mascotSequenceTimer = undefined;
      if (pageActive) {
        transition();
      }
    }, delay);
  },
  startInputMascot() {
    if (inputAnimationStarted) {
      return;
    }
    inputAnimationStarted = true;

    if (mascotScheme === "laptop") {
      const elapsed = Math.max(0, Date.now() - laptopCycleStartedAt);
      const currentCycleTime = elapsed % LAPTOP_DURATION_MS;
      const remaining = Math.max(80, LAPTOP_DURATION_MS - currentCycleTime);
      this.scheduleMascotTransition(remaining, () => {
        this.playMascot("magnifier", "mascot-position--right");
      });
      return;
    }

    const elapsed = Math.max(0, Date.now() - lurkingCycleStartedAt);
    const lurkingCycleTime = elapsed % LURKING_DURATION_MS;
    const remaining = LURKING_DURATION_MS - lurkingCycleTime;
    this.scheduleMascotTransition(remaining, () => {
      this.startCrabwalkingMascot();
    });
  },
  startCrabwalkingMascot() {
    this.playMascot(
      "crabwalking",
      "mascot-position--traverse",
      "mascot-motion--walk-leg",
    );
    this.scheduleMascotTransition(CRABWALKING_LEG_MS, () => {
      this.playMascot("waving", "mascot-position--middle");
      this.scheduleMascotTransition(WAVING_DURATION_MS, () => {
        this.playMascot(
          "crabwalking",
          "mascot-position--middle",
          "mascot-motion--walk-leg",
        );
        this.scheduleMascotTransition(CRABWALKING_LEG_MS, () => {
          this.playMascot("waving", "mascot-position--right");
          this.scheduleMascotTransition(WAVING_DURATION_MS, () => {
            this.playMascot("dancing", "mascot-position--right");
          });
        });
      });
    });
  },
  startSubmitMascot() {
    clearMascotSequenceTimer();
    mascotRevision += 1;
    const now = Date.now();
    const positionClass = this.data.mascotPositionClass;
    let positionStyle = this.data.mascotPositionStyle;

    if (
      currentMascot === "crabwalking" &&
      this.data.mascotMotionClass === "mascot-motion--walk-leg"
    ) {
      const startLeftRpx =
        positionClass === "mascot-position--traverse" ? -380 : 0;
      const currentLeftRpx = resolveWalkingPositionRpx(
        startLeftRpx,
        this.data.motionClass === "motion-reduced"
          ? CRABWALKING_LEG_MS
          : now - walkingLegStartedAt,
      );
      positionStyle = `left: ${currentLeftRpx.toFixed(2)}rpx; right: auto; transform: none;`;
    }

    if (currentMascot === "waving") {
      submitAnimationStartedAt = mascotAnimationStartedAt || now;
      this.setData({
        mascotPositionClass: positionClass,
        mascotPositionStyle: positionStyle,
        mascotMotionClass: "",
      });
      return;
    }

    this.playMascot("waving", positionClass, "", positionStyle);
    submitAnimationStartedAt = mascotAnimationStartedAt;
  },
  resumeMascotAfterSubmit() {
    const elapsed = Math.max(0, Date.now() - submitAnimationStartedAt);
    const remaining = Math.max(0, WAVING_DURATION_MS - elapsed);
    this.scheduleMascotTransition(remaining, () => {
      if (mascotScheme === "laptop") {
        if (inputAnimationStarted) {
          this.playMascot("magnifier", "mascot-position--right");
        } else {
          laptopCycleStartedAt = Date.now();
          this.playMascot("laptop", "mascot-position--right");
        }
        return;
      }

      const resumePositionClass = this.data.mascotPositionClass;
      const resumePositionStyle = this.data.mascotPositionStyle;
      this.playMascot(
        inputAnimationStarted ? "dancing" : "lurking",
        inputAnimationStarted
          ? resumePositionClass
          : "mascot-position--left",
        "",
        inputAnimationStarted ? resumePositionStyle : "",
      );
    });
  },
  async beginHomeTransition(): Promise<boolean> {
    const handoffDelay = resolveLoginHandoffDelay(
      submitAnimationStartedAt,
      Date.now(),
      this.data.motionClass === "motion-reduced",
    );
    if (handoffDelay > 0) {
      await waitFor(handoffDelay);
    }
    return pageActive;
  },
  showErrorToast(message: string) {
    clearErrorToastTimers();
    const normalizedMessage = normalizeLoginErrorMessage(message);
    const revealToast = () => {
      if (!pageActive) {
        return;
      }
      this.setData({
        errorMessage: normalizedMessage,
        errorToastPhase: "visible",
      });
      errorToastTimer = setTimeout(() => {
        errorToastTimer = undefined;
        if (!pageActive) {
          return;
        }
        this.setData({ errorToastPhase: "leaving" });
        errorToastCleanupTimer = setTimeout(() => {
          errorToastCleanupTimer = undefined;
          if (pageActive) {
            this.setData({ errorMessage: "", errorToastPhase: "" });
          }
        }, ERROR_TOAST_EXIT_MS);
      }, ERROR_TOAST_HOLD_MS);
    };

    if (this.data.errorMessage) {
      this.setData({ errorMessage: "", errorToastPhase: "" }, revealToast);
      return;
    }
    revealToast();
  },
  dismissErrorToast() {
    clearErrorToastTimers();
    if (!this.data.errorMessage && !this.data.errorToastPhase) {
      return;
    }
    this.setData({ errorMessage: "", errorToastPhase: "" });
  },
  onAccountInput(event: WechatMiniprogram.Input) {
    const account = event.detail.value;
    this.setData({ account });
    if (account) {
      this.startInputMascot();
    }
  },
  onPasswordInput(event: WechatMiniprogram.Input) {
    const password = event.detail.value;
    this.setData({ password });
    if (password) {
      this.startInputMascot();
    }
  },
  onAccountFocus() {
    this.setData({ accountFocused: true });
  },
  onAccountBlur() {
    this.setData({ accountFocused: false });
  },
  onPasswordFocus() {
    this.setData({ passwordFocused: true });
  },
  onPasswordBlur() {
    this.setData({ passwordFocused: false });
  },
  togglePassword() {
    haptic("light");
    this.setData({ passwordVisible: !this.data.passwordVisible });
  },
  toggleAgreement() {
    haptic("light");
    this.setData({ agreementAccepted: !this.data.agreementAccepted });
  },
  async onSubmit() {
    if (this.data.loading) {
      return;
    }

    this.startSubmitMascot();
    const account = this.data.account.trim();
    const password = this.data.password;
    if (!account || !password) {
      haptic("heavy");
      this.showErrorToast("请输入学号和统一身份认证密码。");
      this.resumeMascotAfterSubmit();
      return;
    }
    if (!this.data.agreementAccepted) {
      haptic("heavy");
      this.showErrorToast("请先同意用户协议和隐私政策。");
      this.resumeMascotAfterSubmit();
      return;
    }

    this.dismissErrorToast();
    this.setData({ loading: true });
    try {
      const session = await login(account, password);
      preloadPrimaryTabs(session);
      void getPreloadedCurrentUser().catch(() => undefined);
      void refreshExamsAfterSignIn(session);
      routingToHome = true;
      if (!(await this.beginHomeTransition())) {
        return;
      }
      haptic("medium");
      routeAfterAuthentication(() => {
        routingToHome = false;
        if (!pageActive) {
          return;
        }
        this.setData({ loading: false });
        this.showErrorToast("暂时无法进入首页，请重试。");
      });
    } catch (error) {
      haptic("heavy");
      this.showErrorToast(
        getErrorMessage(error, "登录失败，请检查账号、密码和网络。"),
      );
      this.resumeMascotAfterSubmit();
    } finally {
      if (pageActive && !routingToHome) {
        this.setData({ loading: false });
      }
    }
  },
});
