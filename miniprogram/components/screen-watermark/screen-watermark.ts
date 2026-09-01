import { getScreenWatermark } from "../../services/watermark";
import { getSession } from "../../store/session";
import { createScreenWatermarkSource } from "../../utils/screen-watermark";

interface WatermarkRuntime {
  generation: number;
  resizeHandler: () => void;
}

const runtimes = new WeakMap<object, WatermarkRuntime>();

Component({
  data: {
    source: "",
  },
  lifetimes: {
    attached() {
      const runtime: WatermarkRuntime = {
        generation: 0,
        resizeHandler: () => this.refreshWatermark(),
      };
      runtimes.set(this, runtime);
      wx.onWindowResize(runtime.resizeHandler);
      void this.refreshWatermark();
    },
    detached() {
      const runtime = runtimes.get(this);
      if (!runtime) return;
      runtime.generation += 1;
      wx.offWindowResize(runtime.resizeHandler);
      runtimes.delete(this);
    },
  },
  pageLifetimes: {
    show() {
      void this.refreshWatermark();
    },
  },
  methods: {
    async refreshWatermark() {
      const runtime = runtimes.get(this);
      if (!runtime) return;
      const generation = ++runtime.generation;
      if (!getSession()) {
        if (this.data.source) this.setData({ source: "" });
        return;
      }
      const payload = await getScreenWatermark();
      if (!payload || runtime.generation !== generation || !getSession()) {
        return;
      }
      const metrics = windowMetrics();
      const source = createScreenWatermarkSource(
        payload,
        metrics.width,
        metrics.height,
        metrics.pixelRatio,
      );
      if (runtime.generation === generation && source !== this.data.source) {
        this.setData({ source });
      }
    },
  },
});

function windowMetrics(): {
  width: number;
  height: number;
  pixelRatio: number;
} {
  const info = wx.getWindowInfo();
  return {
    width: Number(info.windowWidth) || 375,
    height: Number(info.windowHeight) || 812,
    pixelRatio: Number(info.pixelRatio) || 1,
  };
}
