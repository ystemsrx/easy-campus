import { MINIPROGRAM_NAME } from "../../config/env";
import { login } from "../../services/auth";
import { refreshExamsAfterSignIn } from "../../services/cache-refresh";
import {
  getPreloadedCurrentUser,
  preloadPrimaryTabs,
} from "../../services/primary-tab-preload";
import { getErrorMessage } from "../../services/request";
import { isAuthenticated } from "../../store/session";
import { resolveAppearance } from "../../utils/appearance";
import { haptic } from "../../utils/haptics";

type MascotName =
  "laptop" | "magnifier" | "lurking" | "crabwalking" | "waving" | "dancing";
type MascotScheme = "laptop" | "lurking";

const MASCOT_SOURCES: Record<MascotName, string> = {
  laptop: "/assets/login/laptop.gif",
  magnifier: "/assets/login/magnifier.gif",
  lurking: "/assets/login/lurking.gif",
  crabwalking: "/assets/login/crabwalking.gif",
  waving: "/assets/login/waving.gif",
  dancing: "/assets/login/dancing.gif",
};

const LAPTOP_DURATION_MS = 3580;
const LURKING_DURATION_MS = 5580;
const CRABWALKING_LEG_MS = 1660;
const WAVING_DURATION_MS = 1410;
const ERROR_TOAST_HOLD_MS = 3000;
const ERROR_TOAST_EXIT_MS = 320;

let mascotScheme: MascotScheme = "laptop";
let currentMascot: MascotName | "" = "";
let mascotSequenceTimer: ReturnType<typeof setTimeout> | undefined;
let errorToastTimer: ReturnType<typeof setTimeout> | undefined;
let errorToastCleanupTimer: ReturnType<typeof setTimeout> | undefined;
let laptopCycleStartedAt = 0;
let lurkingCycleStartedAt = 0;
let submitAnimationStartedAt = 0;
let inputAnimationStarted = false;
let mascotRevision = 0;
let pageActive = false;

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

function routeAfterAuthentication(): void {
  wx.switchTab({ url: "/pages/home/index" });
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
    mascotMotionClass: "",
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
  },
  onLoad() {
    currentMascot = "";
    if (isAuthenticated()) {
      routeAfterAuthentication();
      return;
    }

    pageActive = true;
    inputAnimationStarted = false;
    mascotRevision = 0;
    clearMascotSequenceTimer();
    clearErrorToastTimers();
    this.applyAppearance();
    this.startInitialMascot();
  },
  onShow() {
    this.applyAppearance();
  },
  onUnload() {
    pageActive = false;
    currentMascot = "";
    mascotRevision += 1;
    clearMascotSequenceTimer();
    clearErrorToastTimers();
  },
  applyAppearance() {
    this.setData(resolveAppearance());
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
  playMascot(mascot: MascotName, positionClass: string, motionClass = "") {
    clearMascotSequenceTimer();
    mascotRevision += 1;
    const revision = mascotRevision;
    if (mascot === "lurking") {
      lurkingCycleStartedAt = Date.now();
    }
    const shouldRestart = currentMascot === mascot;
    currentMascot = mascot;
    if (!shouldRestart) {
      this.setData({
        mascotSrc: MASCOT_SOURCES[mascot],
        mascotPositionClass: positionClass,
        mascotMotionClass: motionClass,
      });
      return;
    }
    this.setData(
      {
        mascotSrc: "",
        mascotPositionClass: positionClass,
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
    submitAnimationStartedAt = Date.now();
    this.playMascot("waving", "mascot-position--right");
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

      this.playMascot(
        inputAnimationStarted ? "dancing" : "lurking",
        inputAnimationStarted
          ? "mascot-position--right"
          : "mascot-position--left",
      );
    });
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

    const wavingCompletion = waitFor(WAVING_DURATION_MS);
    this.dismissErrorToast();
    this.setData({ loading: true });
    try {
      const session = await login(account, password);
      preloadPrimaryTabs(session);
      void getPreloadedCurrentUser().catch(() => undefined);
      void refreshExamsAfterSignIn(session);
      await wavingCompletion;
      if (!pageActive) {
        return;
      }
      haptic("medium");
      routeAfterAuthentication();
    } catch (error) {
      haptic("heavy");
      this.showErrorToast(
        getErrorMessage(error, "登录失败，请检查账号、密码和网络。"),
      );
      this.resumeMascotAfterSubmit();
    } finally {
      if (pageActive) {
        this.setData({ loading: false });
      }
    }
  },
});
