import {
  DEFAULT_NAVIGATION,
  NAVIGATION_ITEMS,
  loadNavigation,
  navigationItem,
  reconcileNavigation,
  saveNavigation,
  type NavigationId,
  type NavigationSettings,
} from "../../../store/navigation";
import { loadPreferences } from "../../../store/preferences";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../../utils/appearance";
import { ensureAuthenticated } from "../../../utils/navigation";
import { haptic } from "../../../utils/haptics";
import { touchPoint } from "../../../utils/glass-drag";
import {
  clamp,
  dropIntent,
  navigationAfterDrop,
  type DropIntent,
  type Rect,
} from "../../utils/navigation-editor";

type Point = { x: number; y: number };
interface Geometry extends Rect {
  mode: number;
  tilt: number;
}
interface Drag {
  id: NavigationId;
  finger: number;
  start: Point;
  point: Point;
  active: boolean;
  nav?: Rect;
  available?: Rect;
  viewport?: Rect;
  source?: Rect;
  scrollStart: number;
  anchorX: number;
  anchorY: number;
  lastFrame?: number;
  intent: DropIntent;
  geometry?: Geometry;
}
interface Runtime {
  draft: NavigationSettings;
  available: NavigationId[];
  undo?: { draft: NavigationSettings; available: NavigationId[] };
  drag?: Drag;
  timers: Set<ReturnType<typeof setTimeout>>;
  frame?: ReturnType<typeof setTimeout>;
  suppressUntil: number;
  scrollTop: number;
  ratio: number;
  disposed: boolean;
  flight: number;
}
const runtimes = new WeakMap<object, Runtime>();
const state = (host: object) => runtimes.get(host)!;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const ROW_RPX = 128;
const CARD_RPX = 112;
const TIP = "拖动排序 · 向下拖回备选";
function timer(host: object, callback: () => void, delay: number) {
  const runtime = state(host);
  const id = setTimeout(() => {
    runtime.timers.delete(id);
    if (!runtime.disposed) callback();
  }, delay);
  runtime.timers.add(id);
  return id;
}
function editorNavRect(drag: Drag, count: number, ratio: number): Rect {
  const original = drag.nav!;
  const width =
    Math.min((count * 152 + 72) * ratio, drag.available!.width) - 20 * ratio;
  return {
    ...original,
    width,
    left: original.left + (original.width - width) / 2,
  };
}
function proxyStyles(
  g: Geometry,
  ratio: number,
  dark = false,
  labelLength = 2,
  lift = 1,
  dock = 0,
  minimal = false,
  glass = false,
) {
  const t = clamp(g.mode, 0, 1),
    size = (72 - 36 * t) * ratio;
  const mix = (a: number, b: number) => a + (b - a) * t;
  // The lifted card becomes the same horizontal capsule as a real navigation item.
  const groupWidth = (36 + 10 + 25 * labelLength) * ratio;
  const radius = mix((minimal ? 6 : 28) * ratio, g.height / 2);
  return {
    style: `width:${g.width}px;height:${g.height}px;transform:translate(${g.left}px,${g.top}px) rotate(${g.tilt}deg);border-radius:${radius}px;`,
    surfaceStyle: `border-radius:${radius}px;`,
    shadowOpacity: lift,
    capsuleOpacity: t * (1 - dock),
    rowOpacity: 1 - t,
    iconStyle: `width:${size}px;height:${size}px;left:${mix(24 * ratio, Math.max(8 * ratio, (g.width - groupWidth) / 2))}px;top:${(g.height - size) / 2}px;`,
    labelStyle: `left:${mix(118 * ratio, Math.max(8 * ratio, (g.width - groupWidth) / 2) + 46 * ratio)}px;top:${mix(g.height / 2 - 29 * ratio, (g.height - 36 * ratio) / 2)}px;font-size:${mix(27, 25) * ratio}px;`,
    descriptionStyle: `top:${g.height / 2 + 8 * ratio}px;opacity:${clamp(1 - t * 2.6, 0, 1)};`,
    capsule: t > 0.5,
    iconSize: mix(40, 36),
    iconTone: t > 0.5 && !glass ? "muted" : dark ? "white" : "ink",
    iconSurfaceOpacity: 1 - t,
    opacity: 1,
  };
}

Page({
  data: {
    ...resolveAppearance(loadPreferences()),
    cards: NAVIGATION_ITEMS.map((item) => ({
      ...item,
      navStyle: "",
      availableStyle: "",
      navIndex: -1,
      availableIndex: -1,
    })),
    draftItems: [...DEFAULT_NAVIGATION],
    availableHeight: 384,
    count: 3,
    selectedCount: 3,
    landingOpacity: 0,
    dragging: false,
    dragId: "",
    landingIds: [] as NavigationId[],
    replacementId: "",
    editorOver: false,
    tip: TIP,
    scrollTop: 0,
    sheet: "",
    sheetTitle: "",
    selectedId: "" as NavigationId | "",
    selectedName: "",
    selectedIndex: 0,
    choices: NAVIGATION_ITEMS.slice(0, 3),
    replacementChoices: NAVIGATION_ITEMS.slice(0, 2),
    toast: "",
    canUndo: false,
    proxies: [] as Array<
      ReturnType<typeof proxyStyles> & {
        id: NavigationId;
        text: string;
        icon: string;
        description: string;
      }
    >,
    flying: false,
  },
  onLoad() {
    const saved = loadNavigation();
    runtimes.set(this, {
      draft: saved,
      available: NAVIGATION_ITEMS.filter(
        (item) => !saved.items.includes(item.id),
      ).map((item) => item.id),
      timers: new Set(),
      suppressUntil: 0,
      scrollTop: 0,
      ratio: wx.getWindowInfo().windowWidth / 750,
      disposed: false,
      flight: 0,
    });
    this.renderDraft();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    const appearance = resolveAppearance(loadPreferences());
    this.setData(appearance);
    syncWindowBackground(appearance);
  },
  onHide() {
    this.cancelGesture();
  },
  onResize() {
    this.cancelGesture();
    state(this).ratio = wx.getWindowInfo().windowWidth / 750;
  },
  onUnload() {
    const runtime = state(this);
    runtime.disposed = true;
    runtime.timers.forEach(clearTimeout);
    runtimes.delete(this);
  },
  renderDraft(preview?: NavigationId[]) {
    const runtime = state(this),
      items = preview || runtime.draft.items;
    this.setData({
      cards: NAVIGATION_ITEMS.map((item) => {
        const n = items.indexOf(item.id),
          a = runtime.available.indexOf(item.id);
        return {
          ...item,
          navIndex: n,
          availableIndex: a,
          navStyle: `width:calc((100% - 20rpx) / ${items.length});transform:translateX(${Math.max(0, n) * 100}%);opacity:${n < 0 ? 0 : 1};pointer-events:${n < 0 ? "none" : "auto"};`,
          availableStyle: `transform:translateY(${Math.max(0, a) * ROW_RPX}rpx);opacity:${a < 0 ? 0 : 1};pointer-events:${a < 0 ? "none" : "auto"};`,
        };
      }),
      draftItems: [...runtime.draft.items],
      choices: runtime.draft.items.map(navigationItem),
      replacementChoices: runtime.draft.items
        .filter((id) => id !== "profile")
        .map(navigationItem),
      count: items.length,
      selectedCount: runtime.draft.items.length,
      availableHeight: runtime.available.length * ROW_RPX,
      selectedIndex: runtime.draft.items.indexOf(
        this.data.selectedId as NavigationId,
      ),
    });
  },
  commit(
    next: NavigationSettings,
    available?: NavigationId[],
    message = "已调整",
  ) {
    const runtime = state(this);
    if (same(next, runtime.draft)) {
      this.renderDraft();
      return;
    }
    try {
      saveNavigation(next);
    } catch {
      this.notify("调整失败，请重试");
      this.renderDraft();
      return;
    }
    runtime.undo = { draft: runtime.draft, available: [...runtime.available] };
    runtime.draft = next;
    runtime.available = (available || runtime.available).filter(
      (id) => !next.items.includes(id),
    );
    for (const item of NAVIGATION_ITEMS)
      if (!next.items.includes(item.id) && !runtime.available.includes(item.id))
        runtime.available.push(item.id);
    this.renderDraft();
    this.notify(message, true);
    haptic("light");
  },
  notify(message: string, undo = false) {
    this.setData({ toast: message, canUndo: undo });
    timer(
      this,
      () => {
        if (this.data.toast === message) this.setData({ toast: "" });
      },
      undo ? 6000 : 2600,
    );
  },
  undo() {
    const runtime = state(this),
      undo = runtime.undo;
    if (!undo) return;
    try {
      saveNavigation(undo.draft);
    } catch {
      this.notify("撤销失败，请重试");
      return;
    }
    this.finishFlights();
    runtime.draft = undo.draft;
    runtime.available = undo.available;
    runtime.undo = undefined;
    this.renderDraft();
    this.notify("已撤销");
  },
  finishFlights() {
    const runtime = state(this);
    runtime.flight++;
    runtime.timers.forEach(clearTimeout);
    runtime.timers.clear();
    runtime.frame = undefined;
    this.setData({
      proxies: [],
      flying: false,
      landingIds: [],
      landingOpacity: 0,
    });
  },
  onTouchStart(event: WechatMiniprogram.TouchEvent) {
    const runtime = state(this);
    if (runtime.drag || this.data.sheet || event.touches.length !== 1) return;
    this.finishFlights();
    const id = event.currentTarget.dataset.id as NavigationId;
    const origin = event.currentTarget.dataset.origin as string;
    const touch = event.touches[0],
      point = touchPoint(touch);
    const drag: Drag = {
      id,
      finger: touch.identifier,
      start: point,
      point,
      active: false,
      scrollStart: runtime.scrollTop,
      anchorX: 0.5,
      anchorY: 0.5,
      intent: { kind: "none" },
    };
    runtime.drag = drag;
    const query = this.createSelectorQuery();
    query.select(".nav-track").boundingClientRect();
    query.select(".available-track").boundingClientRect();
    query.select(".available-scroll").boundingClientRect();
    query.select(`#${origin}-${id}`).boundingClientRect();
    query.exec((rects: Array<Rect | null>) => {
      if (
        runtime.drag !== drag ||
        runtime.disposed ||
        rects.some((rect) => !rect)
      )
        return;
      [drag.nav, drag.available, drag.viewport, drag.source] = rects as Rect[];
      const inset = 10 * runtime.ratio;
      drag.nav = {
        ...drag.nav!,
        left: drag.nav!.left + inset,
        top: drag.nav!.top + inset,
        width: drag.nav!.width - inset * 2,
        height: drag.nav!.height - inset * 2,
      };
      drag.anchorX = clamp(
        (drag.start.x - drag.source!.left) / drag.source!.width,
        0.08,
        0.92,
      );
      drag.anchorY = clamp(
        (drag.start.y - drag.source!.top) / drag.source!.height,
        0.1,
        0.9,
      );
      this.updateDrag();
    });
  },
  onTouchMove(event: WechatMiniprogram.TouchEvent) {
    const runtime = state(this),
      drag = runtime.drag;
    if (!drag) return;
    const touch = event.touches.find((item) => item.identifier === drag.finger);
    if (!touch) return;
    drag.point = touchPoint(touch);
    if (!runtime.frame)
      runtime.frame = timer(
        this,
        () => {
          runtime.frame = undefined;
          this.updateDrag();
        },
        16,
      );
  },
  updateDrag() {
    const runtime = state(this),
      drag = runtime.drag;
    if (!drag?.nav || !drag.source || !drag.available || !drag.viewport) return;
    if (
      !drag.active &&
      Math.hypot(drag.point.x - drag.start.x, drag.point.y - drag.start.y) < 4
    )
      return;
    const justStarted = !drag.active;
    if (justStarted) {
      drag.active = true;
      drag.geometry = {
        ...drag.source,
        mode: runtime.draft.items.includes(drag.id) ? 1 : 0,
        tilt: 0,
      };
      drag.lastFrame = Date.now();
      haptic("light");
      this.setData({ dragging: true, dragId: drag.id, toast: "" });
    }
    const fromNav = runtime.draft.items.includes(drag.id);
    const targetCount = Math.min(
      4,
      runtime.draft.items.length + (fromNav ? 0 : 1),
    );
    const nav = editorNavRect(drag, targetCount, runtime.ratio);
    const available = {
      ...drag.available,
      top: drag.available.top - (runtime.scrollTop - drag.scrollStart),
    };
    const intent = dropIntent({
      id: drag.id,
      items: runtime.draft.items,
      ...drag.point,
      nav,
      available,
      viewport: drag.viewport,
      rowHeight: ROW_RPX * runtime.ratio,
      availableCount: runtime.available.length,
      previous: drag.intent,
    });
    if (justStarted || !same(intent, drag.intent)) {
      drag.intent = intent;
      const preview =
        intent.kind === "insert" || intent.kind === "reorder"
          ? navigationAfterDrop(runtime.draft.items, drag.id, intent)
          : fromNav && intent.kind !== "locked"
            ? runtime.draft.items.filter((id) => id !== drag.id)
            : runtime.draft.items;
      this.renderDraft(preview);
      const replacement =
        intent.kind === "replace" ? runtime.draft.items[intent.index] : "";
      const tip =
        intent.kind === "insert" || intent.kind === "reorder"
          ? `松手放在第 ${intent.index + 1} 位`
          : intent.kind === "replace"
            ? `松手替换「${navigationItem(replacement as NavigationId).text}」`
            : intent.kind === "remove"
              ? "松手移回备选"
              : intent.kind === "locked"
                ? "「我的」只能调整顺序"
                : intent.kind === "blocked"
                  ? "至少保留 3 个导航"
                  : "拖到导航栏或备选区域";
      this.setData({
        tip,
        replacementId: replacement,
        editorOver: ["insert", "replace", "reorder"].includes(intent.kind),
      });
    }
    const mode = 1;
    const width =
      drag.source.width + (nav.width / targetCount - drag.source.width) * mode;
    const height =
      drag.source.height + (nav.height - drag.source.height) * mode;
    const target: Geometry = {
      left: drag.point.x - width * drag.anchorX,
      top: drag.point.y - height * drag.anchorY - 6,
      width,
      height,
      mode,
      tilt:
        this.data.motionClass === "motion-reduced"
          ? 0
          : clamp(
              (drag.point.x -
                (drag.geometry
                  ? drag.geometry.left + drag.geometry.width * drag.anchorX
                  : drag.point.x)) *
                0.16,
              -2.3,
              2.3,
            ),
    };
    const now = Date.now(),
      dt = clamp((now - (drag.lastFrame || now)) / 1000, 0.001, 0.035);
    drag.lastFrame = now;
    const current = drag.geometry!;
    const geometry = {} as Geometry;
    const reduced = this.data.motionClass === "motion-reduced";
    for (const key of [
      "left",
      "top",
      "width",
      "height",
      "mode",
      "tilt",
    ] as const) {
      const follow = reduced
        ? 1
        : 1 - Math.exp(-(["left", "top"].includes(key) ? 38 : 22) * dt);
      geometry[key] = current[key] + (target[key] - current[key]) * follow;
    }
    drag.geometry = geometry;
    this.setData({
      proxies: [
        {
          ...navigationItem(drag.id),
          ...proxyStyles(
            geometry,
            runtime.ratio,
            this.data.theme === "dark",
            navigationItem(drag.id).text.length,
            1,
            0,
            this.data.visualTheme === "minimal",
            this.data.liquidGlass,
          ),
        },
      ],
    });
    // The navigation stays fixed while the available list scrolls under the pointer.
    const view = drag.viewport,
      maxScroll = Math.max(
        0,
        runtime.available.length * ROW_RPX * runtime.ratio +
          104 * runtime.ratio -
          view.height,
      );
    const edge =
      drag.point.y > view.top + view.height - 40
        ? 6
        : drag.point.y < view.top + 25 &&
            drag.point.y > drag.nav.top + drag.nav.height + 20
          ? -6
          : 0;
    const nextScroll = clamp(runtime.scrollTop + edge, 0, maxScroll);
    if (
      edge &&
      drag.point.x >= view.left &&
      drag.point.x <= view.left + view.width &&
      nextScroll !== runtime.scrollTop
    ) {
      runtime.scrollTop = nextScroll;
      this.setData({ scrollTop: nextScroll });
    }
    if (!runtime.frame)
      runtime.frame = timer(
        this,
        () => {
          runtime.frame = undefined;
          this.updateDrag();
        },
        16,
      );
  },
  onAvailableScroll(event: WechatMiniprogram.ScrollViewScroll) {
    state(this).scrollTop = event.detail.scrollTop;
  },
  onTouchEnd(event: WechatMiniprogram.TouchEvent) {
    const drag = state(this).drag;
    if (!drag) return;
    const touch = event.changedTouches.find(
      (item) => item.identifier === drag.finger,
    );
    if (!touch) return;
    drag.point = touchPoint(touch);
    this.updateDrag();
    this.drop(false);
  },
  onTouchCancel() {
    this.drop(true);
  },
  cancelGesture() {
    const runtime = state(this);
    if (!runtime) return;
    runtime.drag = undefined;
    this.finishFlights();
    this.setData({
      dragging: false,
      dragId: "",
      replacementId: "",
      editorOver: false,
      tip: TIP,
    });
    this.renderDraft();
  },
  drop(cancel: boolean) {
    const runtime = state(this),
      drag = runtime.drag;
    if (!drag) return;
    runtime.drag = undefined;
    if (runtime.frame) {
      clearTimeout(runtime.frame);
      runtime.timers.delete(runtime.frame);
      runtime.frame = undefined;
    }
    if (!drag.active || !drag.geometry || !drag.nav || !drag.available) return;
    runtime.suppressUntil = Date.now() + 400;
    const intent = cancel ? ({ kind: "none" } as DropIntent) : drag.intent;
    const next = navigationAfterDrop(runtime.draft.items, drag.id, intent);
    const outgoing =
      intent.kind === "replace" ? runtime.draft.items[intent.index] : undefined;
    let available = [...runtime.available];
    if (outgoing)
      available = available.map((id) => (id === drag.id ? outgoing : id));
    if (intent.kind === "remove") available.splice(intent.index, 0, drag.id);
    const proxies = [{ id: drag.id, geometry: drag.geometry }];
    if (outgoing && "index" in intent)
      proxies.push({
        id: outgoing,
        geometry: {
          ...drag.nav,
          left:
            drag.nav.left +
            (drag.nav.width / runtime.draft.items.length) * intent.index,
          width: drag.nav.width / runtime.draft.items.length,
          mode: 1,
          tilt: 0,
        },
      });
    // Hide both landing representations before changing their list membership.
    this.setData({
      landingIds: proxies.map((proxy) => proxy.id),
      landingOpacity: 0,
    });
    if (
      intent.kind !== "none" &&
      intent.kind !== "blocked" &&
      intent.kind !== "locked"
    )
      this.commit(
        reconcileNavigation(runtime.draft, next, drag.id, outgoing),
        available,
        outgoing
          ? `已替换「${navigationItem(outgoing).text}」`
          : intent.kind === "remove"
            ? "已移回备选"
            : "已调整导航",
      );
    else {
      this.renderDraft();
      if (intent.kind === "blocked") this.notify("至少保留 3 个导航");
      if (intent.kind === "locked") this.notify("「我的」只能调整顺序");
    }
    this.setData({
      dragging: false,
      dragId: "",
      replacementId: "",
      editorOver: false,
      tip: TIP,
      landingIds: proxies.map((proxy) => proxy.id),
      landingOpacity: 0,
      proxies: proxies.map((proxy) => ({
        ...navigationItem(proxy.id),
        ...proxyStyles(
          proxy.geometry,
          runtime.ratio,
          this.data.theme === "dark",
          navigationItem(proxy.id).text.length,
          1,
          0,
          this.data.visualTheme === "minimal",
          this.data.liquidGlass,
        ),
      })),
      flying: false,
    });
    const destinations = proxies.map((proxy) => {
      const n = runtime.draft.items.indexOf(proxy.id),
        a = runtime.available.indexOf(proxy.id);
      const nav = editorNavRect(
          drag,
          runtime.draft.items.length,
          runtime.ratio,
        ),
        list = drag.available!;
      const geometry: Geometry =
        n >= 0
          ? {
              ...nav,
              left: nav.left + (nav.width / runtime.draft.items.length) * n,
              width: nav.width / runtime.draft.items.length,
              mode: 1,
              tilt: 0,
            }
          : {
              ...list,
              top:
                list.top -
                (runtime.scrollTop - drag.scrollStart) +
                a * ROW_RPX * runtime.ratio,
              height: CARD_RPX * runtime.ratio,
              mode: 0,
              tilt: 0,
            };
      return geometry;
    });
    const flight = ++runtime.flight;
    const started = Date.now(),
      duration = this.data.motionClass === "motion-reduced" ? 0 : 370;
    const land = () => {
      const progress = duration
        ? clamp((Date.now() - started) / duration, 0, 1)
        : 1;
      const eased = 1 - Math.pow(1 - progress, 3),
        crossfade = clamp((progress - 0.6) / 0.4, 0, 1);
      this.setData(
        {
          flying: true,
          landingOpacity: crossfade,
          proxies: proxies.map((proxy, index) => {
            const target = destinations[index],
              geometry = {} as Geometry;
            for (const key of [
              "left",
              "top",
              "width",
              "height",
              "mode",
              "tilt",
            ] as const)
              geometry[key] =
                proxy.geometry[key] +
                (target[key] - proxy.geometry[key]) * eased;
            return {
              ...navigationItem(proxy.id),
              ...proxyStyles(
                geometry,
                runtime.ratio,
                this.data.theme === "dark",
                navigationItem(proxy.id).text.length,
                1 - eased,
                target.mode * eased,
                this.data.visualTheme === "minimal",
                this.data.liquidGlass,
              ),
              opacity: 1 - crossfade,
            };
          }),
        },
        () => {
          if (runtime.disposed || runtime.flight !== flight) return;
          if (progress < 1) timer(this, land, 16);
          // Let Skyline present the fully opaque destination before removing the proxy.
          else
            timer(
              this,
              () => {
                if (runtime.flight !== flight) return;
                this.setData({
                  proxies: [],
                  flying: false,
                  landingIds: [],
                  landingOpacity: 0,
                });
              },
              16,
            );
        },
      );
    };
    timer(this, land, 16);
  },
  onCardTap(event: WechatMiniprogram.TouchEvent) {
    const runtime = state(this);
    if (Date.now() < runtime.suppressUntil || this.data.dragging) return;
    const id = event.currentTarget.dataset.id as NavigationId;
    this.finishFlights();
    this.setData({
      selectedId: id,
      selectedName: navigationItem(id).text,
      selectedIndex: runtime.draft.items.indexOf(id),
      sheet: runtime.draft.items.includes(id) ? "edit" : "add",
      sheetTitle: runtime.draft.items.includes(id)
        ? `调整「${navigationItem(id).text}」`
        : `添加「${navigationItem(id).text}」`,
      toast: "",
    });
  },
  closeSheet() {
    this.setData({ sheet: "" });
  },
  moveSelected(event: WechatMiniprogram.TouchEvent) {
    const runtime = state(this),
      id = this.data.selectedId as NavigationId;
    const index = runtime.draft.items.indexOf(id),
      target = index + Number(event.currentTarget.dataset.offset);
    if (target < 0 || target >= runtime.draft.items.length) return;
    this.commit(
      reconcileNavigation(
        runtime.draft,
        navigationAfterDrop(runtime.draft.items, id, {
          kind: "reorder",
          index: target,
        }),
      ),
    );
  },
  removeSelected() {
    const runtime = state(this);
    if (this.data.selectedId === "profile") return;
    if (runtime.draft.items.length <= 3) {
      this.notify("至少保留 3 个导航");
      return;
    }
    this.commit(
      reconcileNavigation(
        runtime.draft,
        runtime.draft.items.filter((id) => id !== this.data.selectedId),
      ),
      undefined,
      "已移回备选",
    );
    this.closeSheet();
  },
  addSelected() {
    const runtime = state(this);
    if (runtime.draft.items.length >= 4) return;
    const items = [...runtime.draft.items],
      index =
        items[items.length - 1] === "profile" ? items.length - 1 : items.length;
    items.splice(index, 0, this.data.selectedId as NavigationId);
    this.commit(
      reconcileNavigation(runtime.draft, items),
      undefined,
      "已添加导航",
    );
    this.closeSheet();
  },
  replaceSelected(event: WechatMiniprogram.TouchEvent) {
    const runtime = state(this),
      outgoing = event.currentTarget.dataset.id as NavigationId,
      incoming = this.data.selectedId as NavigationId;
    if (outgoing === "profile") return;
    this.commit(
      reconcileNavigation(
        runtime.draft,
        runtime.draft.items.map((id) => (id === outgoing ? incoming : id)),
        incoming,
        outgoing,
      ),
      runtime.available.map((id) => (id === incoming ? outgoing : id)),
      `已替换「${navigationItem(outgoing).text}」`,
    );
    this.closeSheet();
  },
  reset() {
    this.commit(
      { items: [...DEFAULT_NAVIGATION], displaced: {} },
      NAVIGATION_ITEMS.filter((item) => !item.native).map((item) => item.id),
      "已恢复默认",
    );
    this.closeSheet();
  },
});
