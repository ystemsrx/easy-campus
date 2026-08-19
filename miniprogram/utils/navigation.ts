import { getSession } from "../store/session";

interface SkylineNavigateToOptions extends WechatMiniprogram.NavigateToOption {
  routeType?:
    | "wx://bottom-sheet"
    | "wx://upwards"
    | "wx://zoom"
    | "wx://cupertino-modal"
    | "wx://cupertino-modal-inside"
    | "wx://modal-navigation"
    | "wx://modal";
  routeOptions?: Record<string, unknown>;
}

export function navigateTo(
  url: string,
  routeType: SkylineNavigateToOptions["routeType"] = "wx://cupertino-modal",
): Promise<void> {
  return new Promise((resolve, reject) => {
    const options: SkylineNavigateToOptions = {
      url,
      routeType,
      success: () => resolve(),
      fail: (error) => {
        // 旧基础库不认识 routeType 时自动回退到标准路由。
        wx.navigateTo({
          url,
          success: () => resolve(),
          fail: () => reject(error),
        });
      },
    };
    wx.navigateTo(options);
  });
}

let loginRouteOpening = false;
let loginRouteResetTimer: ReturnType<typeof setTimeout> | undefined;

export function goToLogin(): void {
  const pages = getCurrentPages();
  const currentRoute = pages[pages.length - 1]?.route;
  if (currentRoute === "pages/login/index") {
    loginRouteOpening = false;
    return;
  }
  if (loginRouteOpening) return;
  loginRouteOpening = true;
  if (loginRouteResetTimer) clearTimeout(loginRouteResetTimer);
  wx.reLaunch({
    url: "/pages/login/index",
    success: () => {
      loginRouteResetTimer = setTimeout(() => {
        loginRouteOpening = false;
        loginRouteResetTimer = undefined;
      }, 1000);
    },
    fail: () => {
      loginRouteOpening = false;
      loginRouteResetTimer = undefined;
    },
  });
}

export function ensureAuthenticated(): boolean {
  if (getSession()?.token) return true;
  goToLogin();
  return false;
}
