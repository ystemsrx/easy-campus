import { haptic } from "../../utils/haptics";

type GradeSortMode = "default" | "score-desc" | "score-asc";

Component({
  properties: {
    value: { type: String, value: "default" },
    theme: { type: String, value: "light" },
  },
  data: {
    visible: false,
    popoverTop: 0,
    popoverRight: 20,
    options: [
      { value: "default", label: "默认" },
      { value: "score-desc", label: "分数高→低" },
      { value: "score-asc", label: "分数低→高" },
    ],
  },
  pageLifetimes: {
    hide() {
      this.setData({ visible: false });
    },
  },
  methods: {
    toggle(anchor: { bottom: number; right: number }) {
      if (this.data.visible) {
        this.close();
        return;
      }
      const windowInfo = wx.getWindowInfo();
      const bottom = Number(anchor?.bottom);
      const right = Number(anchor?.right);
      this.setData({
        visible: true,
        popoverTop: Number.isFinite(bottom)
          ? Math.max(12, Math.min(bottom + 8, windowInfo.windowHeight - 190))
          : 180,
        popoverRight: Number.isFinite(right)
          ? Math.max(16, windowInfo.windowWidth - right)
          : 20,
      });
    },
    close() {
      this.setData({ visible: false });
    },
    select(event: WechatMiniprogram.TouchEvent) {
      const value = String(event.currentTarget.dataset.value) as GradeSortMode;
      if (!this.data.options.some((option) => option.value === value)) return;
      haptic("light");
      if (value === this.data.value) {
        this.setData({ visible: false });
        return;
      }
      this.setData({ visible: false }, () => {
        this.triggerEvent("change", { value });
      });
    },
    noop() {},
  },
});
