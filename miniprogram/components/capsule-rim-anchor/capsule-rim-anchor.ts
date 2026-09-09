import {
  connectCapsuleSurface,
  type CapsuleRect,
} from "../../utils/capsule-backdrop";
interface Runtime {
  visible: boolean;
  ready: boolean;
  generation: number;
  disconnect?: () => void;
}
const runtimes = new WeakMap<object, Runtime>();
Component({
  properties: { enabled: Boolean, source: String },
  observers: {
    "enabled, source"() {
      this.release();
      this.measure();
    },
  },
  lifetimes: {
    attached() {
      runtimes.set(this, { visible: true, ready: false, generation: 0 });
    },
    ready() {
      const rt = runtimes.get(this);
      if (rt) rt.ready = true;
      this.measure();
    },
    detached() {
      this.release();
      runtimes.delete(this);
    },
  },
  pageLifetimes: {
    show() {
      const rt = runtimes.get(this);
      if (rt) rt.visible = true;
      this.measure();
    },
    hide() {
      const rt = runtimes.get(this);
      if (rt) rt.visible = false;
      this.release();
    },
    resize() {
      this.release();
      this.measure();
    },
  },
  methods: {
    measure() {
      const rt = runtimes.get(this);
      if (
        !rt?.ready ||
        !rt.visible ||
        !this.data.enabled ||
        !this.data.source ||
        !wx.worklet?.shared ||
        rt.disconnect
      )
        return;
      const generation = ++rt.generation;
      wx.nextTick(() => {
        if (generation !== rt.generation) return;
        this.createSelectorQuery()
          .select("#capsule-rim-anchor")
          .boundingClientRect()
          .exec((results) => {
            if (generation !== rt.generation || !rt.visible) return;
            const rect = results[0] as CapsuleRect | undefined;
            if (!rect?.height || rect.width < rect.height) return;
            rt.disconnect = connectCapsuleSurface(this.data.source, { rect });
          });
      });
    },
    release() {
      const rt = runtimes.get(this);
      if (!rt) return;
      rt.generation++;
      rt.disconnect?.();
      rt.disconnect = undefined;
    },
  },
});
