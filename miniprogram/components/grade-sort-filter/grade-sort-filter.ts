import { haptic } from "../../utils/haptics";
import { cancelPresence, MOTION, setPresence } from "../../utils/motion";

type GradeSortMode = "default" | "score-desc" | "score-asc";

Component({
  properties: {
    value: { type: String, value: "default" },
    theme: { type: String, value: "light" },
    reducedMotion: { type: Boolean, value: false },
  },
  data: {
    visible: false,
    mounted: false,
    active: false,
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
      cancelPresence(this);
      this.setData({ visible: false, mounted: false, active: false });
    },
  },
  lifetimes: {
    detached() {
      cancelPresence(this);
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
      setPresence(this, true);
    },
    close() {
      this.setData({ visible: false });
      setPresence(this, false, {
        exitMs: MOTION.popoverExit,
        reducedMotion: this.data.reducedMotion,
      });
    },
    select(event: WechatMiniprogram.TouchEvent) {
      if (!this.data.visible) return;
      const value = String(event.currentTarget.dataset.value) as GradeSortMode;
      if (!this.data.options.some((option) => option.value === value)) return;
      haptic("light");
      this.close();
      if (value === this.data.value) {
        return;
      }
      this.triggerEvent("change", { value });
    },
    noop() {},
  },
});
