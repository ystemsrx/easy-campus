import { resolveAppearance } from "../../utils/appearance";
import { ensureAuthenticated } from "../../utils/navigation";

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    motionClass: "motion-normal",
  },
  onLoad() {
    this.setData(resolveAppearance());
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.setData(resolveAppearance());
  },
  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/home/index" }) });
  },
});
