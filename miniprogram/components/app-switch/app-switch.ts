import { controlAppearance } from "../../behaviors/control-appearance";
import { touchPoint } from "../../utils/glass-drag";

interface Gesture {
  id: number;
  x: number;
  y: number;
  initial: boolean;
  travel: number;
  dragged: boolean;
  cancelled: boolean;
}
const gestures = new WeakMap<object, Gesture>();
const suppressTap = new WeakSet<object>();
const TRAVEL_RPX = 38;

function trackDragStyle(progress: number, dark: boolean): string {
  // Match the resting WXSS colors, mixing premultiplied alpha like a color transition.
  const off = [125, 137, 116];
  const on = dark ? [172, 190, 151] : [125, 143, 110];
  const offAlpha = 0.2 * (1 - progress);
  const alpha = offAlpha + progress;
  const rgb = off.map((channel, index) =>
    Math.round((channel * offAlpha + on[index] * progress) / alpha),
  );
  return `background-color: rgba(${rgb.join(", ")}, ${alpha.toFixed(3)});`;
}

Component({
  behaviors: [controlAppearance],
  properties: {
    checked: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
    color: { type: String, value: "#7d8f6e" },
    label: { type: String, value: "" },
  },
  data: { pressed: false, dragging: false, dragStyle: "", dragTrackStyle: "" },
  observers: {
    "disabled, liquidGlass, checked"() {
      this.cancelGesture();
    },
  },
  lifetimes: {
    detached() {
      gestures.delete(this);
      suppressTap.delete(this);
    },
  },
  pageLifetimes: {
    hide() {
      this.cancelGesture();
    },
  },
  methods: {
    onNativeChange(event: WechatMiniprogram.SwitchChange) {
      if (!this.data.disabled) this.triggerEvent("change", event.detail);
    },
    commit(value: boolean) {
      if (this.data.disabled || value === this.data.checked) return;
      // Controlled by the parent: async settings may reject or defer a change.
      this.triggerEvent("change", { value });
    },
    onTap() {
      if (suppressTap.has(this)) {
        suppressTap.delete(this);
        return;
      }
      this.commit(!this.data.checked);
    },
    onTouchStart(event: WechatMiniprogram.TouchEvent) {
      if (
        this.data.disabled ||
        !this.data.liquidGlass ||
        event.touches.length !== 1
      )
        return;
      const touch = event.touches[0];
      const point = touchPoint(touch);
      suppressTap.delete(this);
      let width = 375;
      try {
        width = wx.getWindowInfo().windowWidth || width;
      } catch {
        /* legacy tools */
      }
      const gesture: Gesture = {
        id: touch.identifier,
        x: point.x,
        y: point.y,
        initial: this.data.checked,
        travel: (TRAVEL_RPX * width) / 750,
        dragged: false,
        cancelled: false,
      };
      gestures.set(this, gesture);
      this.createSelectorQuery()
        .select(".glass-switch-track")
        .boundingClientRect((result) => {
          if (
            gestures.get(this) !== gesture ||
            gesture.cancelled ||
            Array.isArray(result) ||
            !result?.width
          )
            return;
          // Parent settings rows scale native switches to .82; measure that scale too.
          gesture.travel = (result.width * TRAVEL_RPX) / 104;
        })
        .exec();
      this.setData({
        pressed: true,
        dragging: false,
        dragStyle: "",
        dragTrackStyle: "",
      });
    },
    onTouchMove(event: WechatMiniprogram.TouchEvent) {
      const gesture = gestures.get(this);
      if (!gesture || gesture.cancelled) return;
      if (event.touches.length !== 1) {
        this.cancelGesture();
        return;
      }
      const touch = event.touches.find(
        (item) => item.identifier === gesture.id,
      );
      if (!touch) return;
      const point = touchPoint(touch);
      const dx = point.x - gesture.x;
      const dy = point.y - gesture.y;
      // Reject vertical swipes without changing the setting.
      if (!gesture.dragged && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
        this.cancelGesture();
        return;
      }
      if (Math.abs(dx) > 4) gesture.dragged = true;
      if (!gesture.dragged) return;
      const progress = Math.max(
        0,
        Math.min(1, Number(gesture.initial) + dx / gesture.travel),
      );
      this.setData({
        dragging: true,
        dragStyle: `transform: translateX(${progress * TRAVEL_RPX}rpx);`,
        dragTrackStyle: trackDragStyle(
          progress,
          this.data.glassThemeClass === "theme-dark",
        ),
      });
    },
    onTouchEnd(event: WechatMiniprogram.TouchEvent) {
      const gesture = gestures.get(this);
      if (!gesture) return;
      const touch = event.changedTouches.find(
        (item) => item.identifier === gesture.id,
      );
      if (!touch) {
        this.cancelGesture();
        return;
      }
      gestures.delete(this);
      suppressTap.add(this);
      this.setData({
        pressed: false,
        dragging: false,
        dragStyle: "",
        dragTrackStyle: "",
      });
      if (gesture.cancelled) return;
      const progress =
        Number(gesture.initial) +
        (touchPoint(touch).x - gesture.x) / gesture.travel;
      this.commit(gesture.dragged ? progress >= 0.5 : !gesture.initial);
    },
    cancelGesture() {
      const gesture = gestures.get(this);
      if (gesture) {
        gesture.cancelled = true;
        suppressTap.add(this);
      }
      this.setData({
        pressed: false,
        dragging: false,
        dragStyle: "",
        dragTrackStyle: "",
      });
    },
  },
});
