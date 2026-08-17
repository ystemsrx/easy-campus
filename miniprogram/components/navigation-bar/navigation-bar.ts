const BACK_BUTTON_SIZE_RPX = 76;
const NAVIGATION_INSET_RPX = 28;

Component({
  options: {
    multipleSlots: true,
  },
  properties: {
    title: { type: String, value: "" },
    subtitle: { type: String, value: "" },
    back: { type: Boolean, value: false },
    transparent: { type: Boolean, value: false },
    theme: { type: String, value: "light" },
  },
  data: {
    coverHeight: 66,
    controlTop: 28,
    contentHeight: 32,
    backLift: 11,
    totalHeight: 66,
    sideWidth: 88,
  },
  lifetimes: {
    attached() {
      try {
        const menu = wx.getMenuButtonBoundingClientRect();
        const windowInfo = wx.getWindowInfo();
        const controlTop = menu.top || windowInfo.statusBarHeight || 24;
        const contentHeight = menu.height || 32;
        const backButtonSize =
          (BACK_BUTTON_SIZE_RPX * windowInfo.windowWidth) / 750;
        const navigationInset =
          (NAVIGATION_INSET_RPX * windowInfo.windowWidth) / 750;
        const nativeControlBottom = menu.bottom || controlTop + contentHeight;
        const coverHeight = this.data.back
          ? navigationInset * 2 + backButtonSize
          : nativeControlBottom;
        const naturalBackTop =
          controlTop + (contentHeight - backButtonSize) / 2;
        const backLift = Math.max(
          0,
          naturalBackTop - navigationInset,
        );
        this.setData({
          coverHeight,
          controlTop,
          contentHeight,
          backLift,
          totalHeight: coverHeight,
          sideWidth: Math.max(82, windowInfo.windowWidth - menu.left + 8),
        });
      } catch {
        // 默认尺寸已覆盖旧基础库和开发者工具。
      }
    },
  },
  methods: {
    onBack() {
      wx.navigateBack({
        fail: () => wx.switchTab({ url: "/pages/home/index" }),
      });
      this.triggerEvent("back");
    },
  },
});
