import { buildAppShare } from "../../../utils/app-share";
import { loadPreferences } from "../../../store/preferences";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../../utils/appearance";
import { haptic } from "../../../utils/haptics";

const PLATFORM_URL = "https://platform.lazycampus.com";

Page({
  onShareAppMessage: buildAppShare,
  data: {
    ...resolveAppearance(loadPreferences()),
    platformUrl: PLATFORM_URL,
    copied: false,
  },
  pageVisible: false,
  copyJob: 0,
  copyInFlight: false,
  onShow() {
    this.pageVisible = true;
    this.copyInFlight = false;
    const appearance = resolveAppearance(loadPreferences());
    syncWindowBackground(appearance);
    this.setData({ ...appearance, copied: false });
  },
  onHide() {
    this.pageVisible = false;
    this.copyJob += 1;
    this.copyInFlight = false;
  },
  onUnload() {
    this.pageVisible = false;
    this.copyJob += 1;
    this.copyInFlight = false;
  },
  copyUrl() {
    if (this.copyInFlight) return;
    const job = ++this.copyJob;
    const isCurrent = () => this.pageVisible && job === this.copyJob;
    this.copyInFlight = true;
    haptic("light");
    wx.setClipboardData({
      data: PLATFORM_URL,
      success: () => {
        if (isCurrent()) this.setData({ copied: true });
      },
      fail: () => {
        if (!isCurrent()) return;
        this.setData({ copied: false });
        wx.showToast({ title: "复制失败，请长按网址复制", icon: "none" });
      },
      complete: () => {
        if (isCurrent()) this.copyInFlight = false;
      },
    });
  },
});
