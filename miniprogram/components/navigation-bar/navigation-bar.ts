const BACK_BUTTON_SIZE_RPX = 76;
const NAVIGATION_INSET_RPX = 28;
const STANDARD_BACK_BOTTOM_GAP_PX = 4;

Component({
  options: {
    multipleSlots: true,
  },
  properties: {
    title: { type: String, value: "" },
    subtitle: { type: String, value: "" },
    back: { type: Boolean, value: false },
    extraLeft: { type: Boolean, value: false },
    insetBack: { type: Boolean, value: false },
    transparent: { type: Boolean, value: false },
    theme: { type: String, value: "light" },
  },
  data: {
    coverHeight: 64,
    controlTop: 28,
    contentHeight: 32,
    backLift: 0,
    totalHeight: 64,
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
        const insetBack = this.data.back && this.data.insetBack;
        const naturalBackTop =
          controlTop + (contentHeight - backButtonSize) / 2;
        const standardBackCoverHeight =
          naturalBackTop + backButtonSize + STANDARD_BACK_BOTTOM_GAP_PX;
        const coverHeight = insetBack
          ? navigationInset * 2 + backButtonSize
          : this.data.back
            ? Math.max(nativeControlBottom, standardBackCoverHeight)
            : nativeControlBottom;
        const backLift = insetBack
          ? Math.max(0, naturalBackTop - navigationInset)
          : 0;
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
