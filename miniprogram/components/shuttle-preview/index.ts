import { getShuttleMap, previewShuttles } from "../../services/shuttle";
import {
  mayPreviewLocation,
  readLocation,
  ShuttleLocationRecorder,
} from "../../utils/shuttle-location";
import { roadPolylines, vehicleMarker } from "../../utils/shuttle-geo";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
} from "../../store/session";
import { ensureAuthenticated, navigateTo } from "../../utils/navigation";
import { getErrorMessage } from "../../services/request";
import { isDemoSession } from "../../demo/identity";
import { getSession } from "../../store/session";
import type {
  CampusShuttleMap,
  ShuttleMarker,
  ShuttlePolyline,
} from "../../types/shuttle";

interface PreviewRuntime {
  visible: boolean;
  opening: boolean;
  generation: number;
  timer?: ReturnType<typeof setTimeout>;
  recorder?: ShuttleLocationRecorder;
  map?: CampusShuttleMap;
}
const runtimes = new WeakMap<object, PreviewRuntime>();
function runtime(host: object): PreviewRuntime {
  let value = runtimes.get(host);
  if (!value) {
    value = { visible: false, opening: false, generation: 0 };
    runtimes.set(host, value);
  }
  return value;
}
Component({
  properties: {
    active: { type: Boolean, value: true },
    theme: { type: String, value: "light" },
  },
  data: {
    loaded: false,
    authorized: false,
    live: false,
    latitude: 29.8201,
    longitude: 106.4234,
    scale: 14.6,
    markers: [] as ShuttleMarker[],
    polylines: [] as ShuttlePolyline[],
    status: "线路加载中",
    countLabel: "点击查看",
  },
  lifetimes: {
    attached() {
      if (this.properties.active) void this.activate();
    },
    detached() {
      this.deactivate();
      runtimes.delete(this);
    },
  },
  pageLifetimes: {
    show() {
      if (this.properties.active) void this.activate();
    },
    hide() {
      this.deactivate();
    },
  },
  methods: {
    feedback(message: string) {
      const pages = getCurrentPages(),
        page = pages[pages.length - 1];
      const toast = page?.selectComponent("#rate-limit-toast") as {
        show?: (message: string) => void;
      } | null;
      toast?.show?.(message);
    },
    async activate() {
      const state = runtime(this);
      if (state.visible || !this.properties.active || !getSession()) return;
      state.visible = true;
      const generation = ++state.generation,
        lease = captureSessionLease();
      const current = (): boolean =>
        state.visible &&
        generation === state.generation &&
        isSessionLeaseCurrent(lease);
      try {
        if (isDemoSession(getSession())) {
          this.setData({
            status: "体验账号不读取真实位置",
            countLabel: "登录后查看",
          });
          return;
        }
        const map = await getShuttleMap();
        if (!current()) return;
        state.map = map;
        this.setData({
          loaded: true,
          latitude: map.center.latitude,
          longitude: map.center.longitude,
          scale: Math.max(13, map.scale - 1),
          polylines: roadPolylines(map, undefined, true),
          markers: [],
          live: false,
          status: "校园线路总览",
          countLabel: `${map.routes.length} 条线路`,
        });
        const authorized = await mayPreviewLocation();
        if (!current()) return;
        this.setData({ authorized });
        if (authorized) {
          state.recorder = new ShuttleLocationRecorder({
            status: () => undefined,
            fatal: (message) => {
              this.feedback(message);
              this.deactivate();
            },
          });
          state.recorder.start();
          void this.poll(generation);
        } else {
          // Overview refreshes route data only; no location call, vehicle fetch or websocket.
          state.timer = setTimeout(() => {
            this.deactivate();
            void this.activate();
          }, 60000);
        }
      } catch {
        if (current()) {
          this.setData({
            status: state.map ? "校园线路总览" : "暂时无法加载线路",
            countLabel: "点击重试",
            live: false,
          });
          state.timer = setTimeout(() => {
            this.deactivate();
            void this.activate();
          }, 15000);
        }
      }
    },
    deactivate() {
      const state = runtime(this);
      state.visible = false;
      state.generation += 1;
      if (state.timer) clearTimeout(state.timer);
      state.timer = undefined;
      state.recorder?.stop();
      state.recorder = undefined;
    },
    async poll(generation: number) {
      const state = runtime(this),
        startedAt = Date.now(),
        lease = captureSessionLease(),
        recorder = state.recorder;
      const current = (): boolean =>
        state.visible &&
        generation === state.generation &&
        isSessionLeaseCurrent(lease);
      if (!current()) return;
      try {
        if (!(await mayPreviewLocation()) || !current()) {
          if (current()) {
            this.deactivate();
            void this.activate();
          }
          return;
        }
        const raw = await readLocation();
        // An in-flight getLocation callback remains an observation even if the page just hid.
        if (!isSessionLeaseCurrent(lease)) return;
        const sample = recorder?.record(raw, "preview");
        if (!sample || !current()) return;
        const packet = await previewShuttles(sample);
        if (packet.accepted) recorder?.acknowledge(packet.accepted);
        if (!current()) return;
        this.setData({
          latitude: raw.latitude,
          longitude: raw.longitude,
          scale: 16,
          markers: [
            ...packet.vehicles
              .slice(0, 5)
              .map((bus, i) => vehicleMarker(bus, 100 + i, 25)),
            {
              id: 1,
              longitude: raw.longitude,
              latitude: raw.latitude,
              iconPath: "/assets/shuttle/user.png",
              width: 18,
              height: 18,
              anchor: { x: 0.5, y: 0.5 },
              zIndex: 2000,
            },
          ],
          live: !packet.stale,
          status: packet.stale
            ? "校车信号暂未更新"
            : packet.vehicles.length
              ? "你附近的校车"
              : "附近暂无校车",
          countLabel: packet.stale
            ? "点击查看详情"
            : `${packet.vehicles.length} 辆 · 10 秒更新`,
        });
        if (packet.mapRevision !== state.map?.revision) {
          const map = await getShuttleMap(true);
          if (current()) {
            state.map = map;
            this.setData({ polylines: roadPolylines(map, undefined, true) });
          }
        }
      } catch {
        if (current())
          this.setData({
            live: false,
            status: "连接暂不可用",
            countLabel: "稍后自动重试",
          });
      } finally {
        if (current())
          state.timer = setTimeout(
            () => {
              void this.poll(generation);
            },
            Math.max(500, 10000 - (Date.now() - startedAt)),
          );
      }
    },
    async openShuttle() {
      if (!this.properties.active || !ensureAuthenticated()) return;
      const state = runtime(this);
      if (state.opening) return;
      state.opening = true;
      const lease = captureSessionLease();
      try {
        if (isDemoSession(getSession())) {
          this.feedback("请使用校园账号查看实时校车");
          return;
        }
        if (!isSessionLeaseCurrent(lease)) return;
        // Browsing routes never requires location. Ask inside the map page.
        const opened = await navigateTo("/features/pages/shuttle/index");
        if (!opened) this.feedback("页面打开失败，请重试");
      } catch (error) {
        this.feedback(getErrorMessage(error, "页面打开失败，请重试"));
      } finally {
        state.opening = false;
      }
    },
  },
});
