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

export function goToLogin(): void {
  const pages = getCurrentPages();
  const currentRoute = pages[pages.length - 1]?.route;
  if (currentRoute === "pages/login/index") {
    return;
  }
  wx.reLaunch({ url: "/pages/login/index" });
}

export function ensureAuthenticated(): boolean {
  if (getApp<IAppOption>().globalData.session?.token) {
    return true;
  }
  goToLogin();
  return false;
}
