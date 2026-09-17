import {
  loadNavigation,
  navigationItem,
  type NavigationId,
} from "../store/navigation";
import { navigateTo } from "./navigation";

export const TAB_ROUTE_TYPE = "easy-swu-tab-instant";
let tabRouteRegistered = false;
let launchNavigationPending = false;

/** Only a default cold launch selects the first tab; deep links and resumes keep their destination. */
export function prepareLaunchNavigation(
  path?: string,
  query: Record<string, unknown> = {},
): void {
  launchNavigationPending =
    (!path || path === "pages/home/index") && Object.keys(query).length === 0;
}

export function openLaunchNavigation(onFailure: () => void): boolean {
  if (!launchNavigationPending) return false;
  launchNavigationPending = false;
  const first = loadNavigation().items[0];
  if (first === "home") return false;
  const fail = () => {
    setTimeout(onFailure, 0);
  };
  try {
    openNavigation(first, () => {}, fail);
  } catch {
    fail();
  }
  return true;
}

function registerTabRoute(): void {
  if (tabRouteRegistered || typeof wx.router?.addRouteBuilder !== "function")
    return;
  wx.router.addRouteBuilder(TAB_ROUTE_TYPE, () => {
    const handlePrimaryAnimation = () => {
      "worklet";
      return { opacity: 1 };
    };
    return {
      opaque: true,
      maintainState: true,
      transitionDuration: 0,
      reverseTransitionDuration: 0,
      barrierColor: "#00000000",
      barrierDismissible: false,
      barrierLabel: "",
      canTransitionTo: false,
      canTransitionFrom: false,
      handlePrimaryAnimation,
    } as WechatMiniprogram.CustomRouteConfig;
  });
  tabRouteRegistered = true;
}

/** Feature tabs reuse one stack slot; native tabs retain their platform instances. */
export function openNavigation(
  id: NavigationId,
  success: () => void,
  fail: () => void,
): void {
  const item = navigationItem(id);
  if (!item) {
    fail();
    return;
  }
  const pages = getCurrentPages();
  const current = pages[pages.length - 1] as
    { route?: string; options?: Record<string, string> } | undefined;
  if (current?.route === item.pagePath.slice(1)) {
    success();
    return;
  }
  if (item.native) {
    wx.switchTab({ url: item.pagePath, success, fail });
    return;
  }
  const options = { url: `${item.pagePath}?navigationTab=1`, success, fail };
  registerTabRoute();
  if (current?.options?.navigationTab === "1") wx.redirectTo(options);
  else
    void navigateTo(options.url, TAB_ROUTE_TYPE).then((opened) =>
      opened ? success() : fail(),
    );
}
