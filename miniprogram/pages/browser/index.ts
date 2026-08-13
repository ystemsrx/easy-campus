import { resolveAppearance } from "../../utils/appearance";
import { haptic } from "../../utils/haptics";
import { ensureAuthenticated } from "../../utils/navigation";

function safeDecode(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function domainFromUrl(url: string): string {
  const match = /^https?:\/\/([^/]+)/i.exec(url);
  return match?.[1] || "学校教务系统";
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
    title: "教务通知",
    url: "",
    domain: "学校教务系统",
  },
  onLoad(options: Record<string, string | undefined>) {
    if (!ensureAuthenticated()) return;
    const url = safeDecode(options.url, "");
    const title = safeDecode(options.title, "教务通知");
    this.setData({
      ...resolveAppearance(),
      title,
      url,
      domain: domainFromUrl(url),
    });
  },
  onShow() {
    this.setData(resolveAppearance());
  },
  copyLink() {
    if (!this.data.url) return;
    wx.setClipboardData({
      data: this.data.url,
      success: () => haptic("medium"),
    });
  },
  showOpenGuide() {
    haptic("light");
    wx.showModal({
      title: "如何打开",
      content:
        "通知链接通常需要校园网或学校 VPN，并可能要求教务系统登录。请复制链接后，在已连接相应网络的浏览器中打开。",
      showCancel: false,
      confirmText: "知道了",
    });
  },
});
