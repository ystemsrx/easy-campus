/** Single live WXML rim; no screenshots, image cache, row windows or selector copy. */
import { CAPSULE_RIM_SCALE, capsuleRimMask } from "./capsule-rim";
import { scheduleDayIndex } from "../data/schedule-render";
type Shared<T> = WechatMiniprogram.Skyline.SharedValue<T>;
export interface CapsuleRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface CapsuleScrollHost {
  _capsuleOffset: Shared<number>;
  _capsuleDayScroll: Shared<number[]>;
}
interface Host {
  data: Record<string, any>;
  setData(patch: Record<string, unknown>, callback?: () => void): void;
  createSelectorQuery(): WechatMiniprogram.SelectorQuery;
  _capsuleOffset?: Shared<number>;
  _capsuleDayScroll?: Shared<number[]>;
  _motion?: { position: Shared<number> } | null;
}
type StyleHost = Pick<
  WechatMiniprogram.Component.TrivialInstance,
  "applyAnimatedStyle" | "clearAnimatedStyle"
>;
interface Surface {
  rect: CapsuleRect;
}
interface Source {
  key: string;
  host?: Host;
  surface?: Surface;
  original?: Host["setData"];
  wrapped?: Host["setData"];
  generation: number;
  timer?: ReturnType<typeof setTimeout>;
  watchdog?: ReturnType<typeof setTimeout>;
  bindings: { selector: string; id: number }[];
  visible?: Shared<number>;
  ready: boolean;
  layouts: number;
  error: string;
  restoreOffset?: number;
}
const sources = new Map<string, Source>();
const hosts = new WeakMap<object, Source>();
function sourceFor(key: string): Source {
  let source = sources.get(key);
  if (!source) {
    source = {
      key,
      generation: 0,
      bindings: [],
      ready: false,
      layouts: 0,
      error: "",
    };
    sources.set(key, source);
  }
  return source;
}
function clear(s: Source) {
  s.generation++;
  if (s.timer !== undefined) clearTimeout(s.timer);
  if (s.watchdog !== undefined) clearTimeout(s.watchdog);
  s.timer = s.watchdog = undefined;
  if (s.visible) s.visible.value = 0;
  s.ready = false;
  const host = s.host as unknown as StyleHost;
  for (const { selector, id } of s.bindings)
    host?.clearAnimatedStyle(selector, [id]);
  s.bindings = [];
}
function unmount(s: Source) {
  clear(s);
  s.restoreOffset = undefined;
  if (s.host?.data.liveGlass?.mounted)
    s.host.setData({ "liveGlass.mounted": false });
}
export function initializeCapsuleBackdrop(host: Host) {
  if (host._capsuleOffset || !wx.worklet?.shared) return;
  host._capsuleOffset = wx.worklet.shared(0);
  host._capsuleDayScroll = wx.worklet.shared([] as number[]);
}
/** Also handle restored offsets: programmatic scrollTop need not emit a scroll event. */
function syncScroll(host: Host, patch: Record<string, unknown>) {
  const tab = patch.activeTab ?? host.data.activeTab;
  const field = tab === "publish" ? "publishScrollTop" : "browseScrollTop";
  if (
    host._capsuleOffset &&
    (patch.activeTab !== undefined || patch[field] !== undefined)
  )
    host._capsuleOffset.value = Number(patch[field] ?? host.data[field]) || 0;
  if (!host._capsuleDayScroll) return;
  if (Array.isArray(patch.dayScrollTops))
    host._capsuleDayScroll.value = patch.dayScrollTops.slice();
  for (const key of Object.keys(patch)) {
    const match = /^dayScrollTops\[(\d+)\]$/.exec(key);
    if (!match) continue;
    const values = host._capsuleDayScroll.value.slice();
    values[Number(match[1])] = Number(patch[key]) || 0;
    host._capsuleDayScroll.value = values;
  }
}
export function attachCapsuleBackdrop(
  host: Host,
  key: "home" | "schedule" | "profile" | "course-assistant",
) {
  initializeCapsuleBackdrop(host);
  if (!host._capsuleOffset) return;
  if (hosts.has(host)) {
    invalidateCapsuleBackdrop(host);
    return;
  }
  const s = sourceFor(key);
  if (s.host) detachCapsuleBackdrop(s.host);
  sources.set(key, s);
  s.host = host;
  hosts.set(host, s);
  syncScroll(host, host.data);
  const original = host.setData;
  s.original = original;
  host.setData = s.wrapped = function (patch, callback) {
    syncScroll(host, patch);
    if (
      patch.activeTab !== undefined &&
      patch.activeTab !== host.data.activeTab
    )
      s.restoreOffset = host._capsuleOffset!.value;
    // Ordinary content/filter/data changes flow directly to the one template.
    // Only replacing the scroll viewport/date window requires a new geometry query.
    const geometry = Object.keys(patch).some((k) =>
      /^(liquidGlass|activeTab|statusLoading|statusError|dayPages|dayCurrent|selectedDate)$/.test(
        k,
      ),
    );
    if (geometry && s.visible) s.visible.value = 0;
    original.call(host, patch, () => {
      try {
        callback?.call(host);
      } finally {
        if (geometry && hosts.get(host) === s) invalidateCapsuleBackdrop(host);
      }
    });
  };
  invalidateCapsuleBackdrop(host);
}
export function detachCapsuleBackdrop(host: Host) {
  const s = hosts.get(host);
  if (!s) return;
  unmount(s);
  hosts.delete(host);
  if (host.setData === s.wrapped && s.original) host.setData = s.original;
  s.host = undefined;
  s.original = s.wrapped = undefined;
  if (!s.surface) sources.delete(s.key);
}
export function connectCapsuleSurface(key: string, surface: Surface) {
  const s = sourceFor(key);
  if (s.surface) unmount(s);
  s.surface = surface;
  if (s.host) invalidateCapsuleBackdrop(s.host);
  return () => {
    if (s.surface !== surface) return;
    unmount(s);
    s.surface = undefined;
    if (!s.host) sources.delete(key);
  };
}
export function invalidateCapsuleBackdrop(host: Host) {
  const s = hosts.get(host);
  if (!s) return;
  if (!host.data.liquidGlass || !s.surface) {
    unmount(s);
    return;
  }
  if (s.timer !== undefined) return;
  s.timer = setTimeout(() => {
    s.timer = undefined;
    measure(s);
  }, 0);
}
function measure(s: Source) {
  const host = s.host,
    surface = s.surface;
  if (!host || !surface || !host.data.liquidGlass || !host._capsuleOffset)
    return;
  clear(s);
  const generation = s.generation;
  s.watchdog = setTimeout(() => {
    if (generation !== s.generation) return;
    s.error = "Native rim layout timed out";
    unmount(s);
  }, 2400);
  const schedule = s.key === "schedule";
  const query = host
    .createSelectorQuery()
    .select("#capsule-scroll-source")
    .fields({ rect: true, size: true, scrollOffset: !schedule });
  if (!schedule)
    query
      .select(
        "#capsule-scroll-source ." +
          (s.key === "home"
            ? "home-content"
            : s.key === "profile"
              ? "profile-content"
              : "assistant-content"),
      )
      .boundingClientRect();
  query.exec((results) => {
    if (generation !== s.generation || s.host !== host) return;
    const viewport = results[0] as
      (CapsuleRect & { scrollTop?: number }) | undefined;
    const content = schedule
      ? viewport
      : (results[1] as CapsuleRect | undefined);
    if (!viewport?.width || !viewport.height || !content?.width) {
      s.error = "Scroll source unavailable";
      unmount(s);
      return;
    }
    const scroll = viewport.scrollTop ?? host._capsuleOffset!.value;
    const before = schedule
      ? 0
      : Math.max(0, content.top + scroll - viewport.top);
    // A new wx:if scroll-view reports zero in its first layout, before it applies
    // scroll-top. Keep the requested restoration, clamped to the measured range.
    const restored =
      s.restoreOffset === undefined
        ? undefined
        : Math.max(
            0,
            Math.min(
              s.restoreOffset,
              content.height + before - viewport.height,
            ),
          );
    if (!schedule) host._capsuleOffset!.value = restored ?? scroll;
    const rect = surface.rect;
    // One scene spans the current date and its immediate neighbours during a swipe.
    // All share the same single outline mask, never one fragment per date.
    const days: { slot: number; index: number }[] = schedule
      ? (host.data.dayPages || [])
          .map((d: any) => ({
            slot: d.slot,
            index: scheduleDayIndex(d.selectedDate),
          }))
          .filter(
            (d: { index: number }) =>
              Math.abs(d.index - (host._motion?.position.value ?? d.index)) <=
              1,
          )
      : [];
    s.visible = wx.worklet.shared(0);
    s.layouts++;
    s.error = "";
    host.setData(
      {
        liveGlass: {
          mounted: true,
          sourceWidth: viewport.width,
          sourceHeight: viewport.height,
          beforeHeight: before,
          days,
          rootStyle: `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;${capsuleRimMask(rect.width, rect.height)}`,
        },
      },
      () => {
        if (generation !== s.generation || s.host !== host) return;
        const styleHost = host as unknown as StyleHost;
        const visible = s.visible!,
          offset = host._capsuleOffset!,
          dayOffsets = host._capsuleDayScroll!,
          dayPosition = host._motion?.position;
        const scale = CAPSULE_RIM_SCALE;
        const tx =
          (rect.width / 2) * (1 - scale) + scale * (viewport.left - rect.left);
        const ty =
          (rect.height / 2) * (1 - scale) + scale * (viewport.top - rect.top);
        const sourceWidth = viewport.width;
        let remaining = 2 + (dayPosition ? days.length : 0);
        const apply = (
          selector: string,
          updater: () => Record<string, string>,
        ) => {
          styleHost.applyAnimatedStyle(
            selector,
            updater,
            { immediate: true, flush: "sync" },
            ({ styleId }) => {
              if (generation !== s.generation) {
                styleHost.clearAnimatedStyle(selector, [styleId]);
                return;
              }
              s.bindings.push({ selector, id: styleId });
              if (--remaining === 0) {
                if (s.watchdog !== undefined) clearTimeout(s.watchdog);
                s.watchdog = undefined;
                if (restored !== undefined) offset.value = restored;
                s.restoreOffset = undefined;
                s.ready = true;
                visible.value = 1;
              }
            },
          );
        };
        apply("#capsule-live-root", () => {
          "worklet";
          return { opacity: String(visible.value) };
        });
        apply("#capsule-live-scene", () => {
          "worklet";
          const y = ty - (schedule ? 0 : scale * offset.value);
          return {
            transform:
              "matrix(" + scale + ",0,0," + scale + "," + tx + "," + y + ")",
          };
        });
        if (dayPosition)
          for (const day of days) {
            const slot = day.slot,
              index = day.index;
            apply("#capsule-live-day-" + slot, () => {
              "worklet";
              return {
                transform:
                  "translate(" +
                  (index - dayPosition.value) * sourceWidth +
                  "px," +
                  -(dayOffsets.value[slot] || 0) +
                  "px)",
              };
            });
          }
      },
    );
  });
}
export function capsuleBackdropMetrics(key: string) {
  const s = sources.get(key);
  return s
    ? {
        renderer: "live-wxml-single-rim",
        ready: s.ready,
        layouts: s.layouts,
        bindings: s.bindings.length,
        parts: s.ready ? 1 : 0,
        snapshots: 0,
        imageCaches: 0,
        error: s.error,
      }
    : null;
}
