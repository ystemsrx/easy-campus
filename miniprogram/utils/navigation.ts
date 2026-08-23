import { getSession } from "../store/session";

type SkylineRouteType =
  | "wx://bottom-sheet"
  | "wx://upwards"
  | "wx://zoom"
  | "wx://cupertino-modal"
  | "wx://cupertino-modal-inside"
  | "wx://modal-navigation"
  | "wx://modal";

interface SkylineNavigateToOptions extends WechatMiniprogram.NavigateToOption {
  routeType?: SkylineRouteType;
  routeOptions?: Record<string, unknown>;
}

const ORDINARY_NAVIGATION_LOCK_MS = 420;
const ORDINARY_NAVIGATION_TIMEOUT_MS = 2000;

let ordinaryNavigationOpening = false;
let ordinaryNavigationUnlockTimer: ReturnType<typeof setTimeout> | undefined;

function releaseOrdinaryNavigation(delay = 0): void {
  if (ordinaryNavigationUnlockTimer !== undefined) {
    clearTimeout(ordinaryNavigationUnlockTimer);
    ordinaryNavigationUnlockTimer = undefined;
  }
  if (delay <= 0) {
    ordinaryNavigationOpening = false;
    return;
  }
  ordinaryNavigationUnlockTimer = setTimeout(() => {
    ordinaryNavigationOpening = false;
    ordinaryNavigationUnlockTimer = undefined;
  }, delay);
}

function isUnsupportedRouteType(error: unknown): boolean {
  const message =
    error && typeof error === "object" && "errMsg" in error
      ? String((error as { errMsg?: unknown }).errMsg || "")
      : String(error || "");
  return /route\s*type/i.test(message);
}

export function navigateTo(
  url: string,
  routeType?: SkylineRouteType,
): Promise<boolean> {
  const target = url.trim();
  if (!target || ordinaryNavigationOpening) {
    return Promise.resolve(false);
  }

  ordinaryNavigationOpening = true;
  return new Promise((resolve) => {
    let settled = false;
    let fallbackAttempted = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    const finish = (opened: boolean) => {
      if (settled) return;
      settled = true;
      if (watchdog !== undefined) clearTimeout(watchdog);
      releaseOrdinaryNavigation(opened ? ORDINARY_NAVIGATION_LOCK_MS : 0);
      resolve(opened);
    };

    const open = (withRouteType: boolean) => {
      const options: SkylineNavigateToOptions = {
        url: target,
        success: () => finish(true),
        fail: (error) => {
          if (
            withRouteType &&
            !fallbackAttempted &&
            isUnsupportedRouteType(error)
          ) {
            fallbackAttempted = true;
            open(false);
            return;
          }
          finish(false);
        },
      };
      if (withRouteType) options.routeType = routeType;
      wx.navigateTo(options);
    };

    watchdog = setTimeout(() => finish(false), ORDINARY_NAVIGATION_TIMEOUT_MS);
    try {
      open(Boolean(routeType));
    } catch (error) {
      if (routeType && !fallbackAttempted && isUnsupportedRouteType(error)) {
        fallbackAttempted = true;
        try {
          open(false);
        } catch {
          finish(false);
        }
      } else {
        finish(false);
      }
    }
  });
}

let loginRouteOpening = false;

const HOME_ROUTE = "pages/home/index";
const HOME_URL = "/pages/home/index";
const LOGIN_ROUTE = "pages/login/index";
const LOGIN_URL = "/pages/login/index";
const AUTH_GUARD_COMMIT_TIMEOUT_MS = 300;
const AUTH_EXIT_COMMIT_TIMEOUT_MS = 400;
export const LOGIN_ROUTE_TYPE = "easy-swu-auth-fade";

let authenticationRouteRegistered = false;

export function registerAuthenticationRoute(): void {
  if (
    authenticationRouteRegistered ||
    typeof wx.router?.addRouteBuilder !== "function"
  ) {
    return;
  }
  try {
    wx.router.addRouteBuilder(LOGIN_ROUTE_TYPE, (routeContext) => {
      const { primaryAnimation } = routeContext;
      const handlePrimaryAnimation = () => {
        "worklet";
        return { opacity: primaryAnimation.value };
      };
      return {
        opaque: false,
        maintainState: true,
        transitionDuration: 240,
        reverseTransitionDuration: 300,
        barrierColor: "#00000000",
        barrierDismissible: false,
        barrierLabel: "",
        canTransitionTo: false,
        canTransitionFrom: false,
        allowEnterRouteSnapshotting: false,
        allowExitRouteSnapshotting: false,
        handlePrimaryAnimation,
      } as WechatMiniprogram.CustomRouteConfig;
    });
    authenticationRouteRegistered = true;
  } catch {
    // 旧基础库会在真正导航时回退到内置向上路由。
  }
}

interface LoginHostPage {
  route?: string;
  prepareForAuthenticationRequired?: (onReady?: () => void) => void;
}

let cachedHomeAuthenticationHost: LoginHostPage | undefined;

export function registerHomeAuthenticationHost(page: LoginHostPage): void {
  cachedHomeAuthenticationHost = page;
}

export function unregisterHomeAuthenticationHost(page: LoginHostPage): void {
  if (cachedHomeAuthenticationHost === page) {
    cachedHomeAuthenticationHost = undefined;
  }
}

function currentPage(): LoginHostPage | undefined {
  const pages = getCurrentPages();
  return pages[pages.length - 1] as LoginHostPage | undefined;
}

function relaunchStandaloneLogin(): void {
  loginRouteOpening = true;
  wx.reLaunch({
    url: `${LOGIN_URL}?standalone=1`,
    success: () => {
      loginRouteOpening = false;
    },
    fail: () => {
      loginRouteOpening = false;
    },
  });
}

function navigateToLogin(): void {
  registerAuthenticationRoute();
  const success = () => {
    loginRouteOpening = false;
  };
  wx.navigateTo({
    url: LOGIN_URL,
    routeType: LOGIN_ROUTE_TYPE,
    success,
    fail: () => {
      // 不支持自定义路由的旧基础库先回退到内置向上路由。
      wx.navigateTo({
        url: LOGIN_URL,
        routeType: "wx://upwards",
        success,
        fail: () => {
          wx.navigateTo({
            url: LOGIN_URL,
            success,
            fail: relaunchStandaloneLogin,
          });
        },
      });
    },
  });
}

function openLoginOverHome(): void {
  const page = currentPage();
  if (page?.route === LOGIN_ROUTE) {
    loginRouteOpening = false;
    return;
  }
  if (page?.route !== HOME_ROUTE) {
    relaunchStandaloneLogin();
    return;
  }

  let navigationStarted = false;
  let guardFallbackTimer: ReturnType<typeof setTimeout> | undefined;
  const navigate = () => {
    if (navigationStarted) return;
    navigationStarted = true;
    if (guardFallbackTimer !== undefined) {
      clearTimeout(guardFallbackTimer);
      guardFallbackTimer = undefined;
    }
    navigateToLogin();
  };

  if (typeof page.prepareForAuthenticationRequired === "function") {
    guardFallbackTimer = setTimeout(navigate, AUTH_GUARD_COMMIT_TIMEOUT_MS);
    try {
      page.prepareForAuthenticationRequired(navigate);
      return;
    } catch {
      // 页面销毁竞态下直接继续导航，登录页仍会提供独立保护层。
    }
  }
  navigate();
}

function relaunchGuardedHome(): void {
  wx.reLaunch({
    url: HOME_URL,
    success: () => {
      setTimeout(openLoginOverHome, 0);
    },
    fail: relaunchStandaloneLogin,
  });
}

function switchToGuardedHome(): void {
  wx.switchTab({
    url: HOME_URL,
    success: () => {
      setTimeout(openLoginOverHome, 0);
    },
    fail: relaunchGuardedHome,
  });
}

function prepareCachedHomeForAuthenticationRequired(onReady: () => void): void {
  const page = cachedHomeAuthenticationHost;
  if (typeof page?.prepareForAuthenticationRequired !== "function") {
    onReady();
    return;
  }

  let finished = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (fallbackTimer !== undefined) {
      clearTimeout(fallbackTimer);
      fallbackTimer = undefined;
    }
    onReady();
  };

  fallbackTimer = setTimeout(finish, AUTH_GUARD_COMMIT_TIMEOUT_MS);
  try {
    page.prepareForAuthenticationRequired(finish);
  } catch {
    finish();
  }
}

function leaveCurrentPage(page: LoginHostPage | undefined): void {
  let pageExitReady = false;
  let cachedHomeReady = false;
  let navigationStarted = false;
  let transitionFallbackTimer: ReturnType<typeof setTimeout> | undefined;
  const switchWhenReady = () => {
    if (navigationStarted || !pageExitReady || !cachedHomeReady) return;
    navigationStarted = true;
    if (transitionFallbackTimer !== undefined) {
      clearTimeout(transitionFallbackTimer);
      transitionFallbackTimer = undefined;
    }
    switchToGuardedHome();
  };

  prepareCachedHomeForAuthenticationRequired(() => {
    cachedHomeReady = true;
    switchWhenReady();
  });

  const finishPageExit = () => {
    pageExitReady = true;
    switchWhenReady();
  };

  if (typeof page?.prepareForAuthenticationRequired === "function") {
    transitionFallbackTimer = setTimeout(
      finishPageExit,
      AUTH_EXIT_COMMIT_TIMEOUT_MS,
    );
    try {
      page.prepareForAuthenticationRequired(finishPageExit);
      return;
    } catch {
      // 页面已经卸载时直接切换到受保护首页。
    }
  }
  finishPageExit();
}

export function goToLogin(): void {
  const page = currentPage();
  const currentRoute = page?.route;
  if (currentRoute === LOGIN_ROUTE) {
    loginRouteOpening = false;
    return;
  }
  if (loginRouteOpening) {
    if (
      currentRoute === HOME_ROUTE &&
      typeof page?.prepareForAuthenticationRequired === "function"
    ) {
      page.prepareForAuthenticationRequired();
    }
    return;
  }
  loginRouteOpening = true;

  if (currentRoute === HOME_ROUTE) {
    openLoginOverHome();
    return;
  }

  leaveCurrentPage(page);
}

export function ensureAuthenticated(): boolean {
  if (getSession()?.token) return true;
  goToLogin();
  return false;
}
