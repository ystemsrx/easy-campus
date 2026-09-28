let pending = false;

export function beginLoginReveal(): void {
  pending = true;
}

export function isLoginRevealPending(): boolean {
  return pending;
}

export function completeLoginReveal(): void {
  pending = false;
}

/** switchTab.success acknowledges navigation, not the end of its native animation. */
export function switchToAuthenticatedHome(onFailure?: () => void): void {
  beginLoginReveal();
  let succeeded = false;
  let routeDone = false;
  let settled = false;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const supportsRouteDone = typeof wx.onAppRouteDone === "function" &&
    typeof wx.offAppRouteDone === "function";
  const cleanup = () => {
    if (fallback !== undefined) clearTimeout(fallback);
    if (supportsRouteDone) wx.offAppRouteDone(onRouteDone);
  };
  const reveal = () => {
    if (settled || !succeeded || !routeDone) return;
    settled = true;
    cleanup();
    const pages = getCurrentPages();
    const page = pages[pages.length - 1] as unknown as {
      route?: string;
      revealAuthenticatedHome?: () => void;
    };
    if (page?.route === "pages/home/index") page.revealAuthenticatedHome?.();
    else pending = false;
  };
  const onRouteDone: WechatMiniprogram.OnAppRouteDoneCallback = (event) => {
    if (String(event?.path || "").replace(/^\//, "") !== "pages/home/index") return;
    routeDone = true;
    reveal();
  };
  if (supportsRouteDone) wx.onAppRouteDone(onRouteDone);
  wx.switchTab({
    url: "/pages/home/index",
    success: () => {
      succeeded = true;
      // Older libraries may expose the listener without delivering a matching event.
      fallback = setTimeout(() => {
        routeDone = true;
        reveal();
      }, 450);
      reveal();
    },
    fail: () => {
      settled = true;
      pending = false;
      cleanup();
      onFailure?.();
    },
  });
}
