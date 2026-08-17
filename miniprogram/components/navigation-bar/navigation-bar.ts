Component({
  options: {
    multipleSlots: true,
  },
  properties: {
    title: { type: String, value: "" },
    subtitle: { type: String, value: "" },
    back: { type: Boolean, value: false },
    backOffset: { type: Number, value: 0 },
    transparent: { type: Boolean, value: false },
    scrolled: { type: Boolean, value: false },
    theme: { type: String, value: "light" },
  },
  data: {
    statusBarHeight: 24,
    contentHeight: 44,
    totalHeight: 68,
    sideWidth: 88,
  },
  lifetimes: {
    attached() {
      try {
        const menu = wx.getMenuButtonBoundingClientRect();
        const windowInfo = wx.getWindowInfo();
        const statusBarHeight = windowInfo.statusBarHeight || menu.top;
        const contentHeight = Math.max(
          50,
          (menu.top - statusBarHeight) * 2 + menu.height,
        );
        this.setData({
          statusBarHeight,
          contentHeight,
          totalHeight: statusBarHeight + contentHeight,
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
