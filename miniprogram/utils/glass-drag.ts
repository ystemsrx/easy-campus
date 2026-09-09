/** Coordinates stay in viewport pixels, including scaled custom controls. */
export function touchPoint(touch: WechatMiniprogram.TouchDetail) {
  const point = touch as Partial<WechatMiniprogram.TouchDetail> & {
    x?: number;
    y?: number;
  };
  return {
    x: point.clientX ?? point.pageX ?? point.x ?? 0,
    y: point.clientY ?? point.pageY ?? point.y ?? 0,
  };
}

interface DragHost {
  setData(data: Record<string, unknown>): void;
  createSelectorQuery(): WechatMiniprogram.SelectorQuery;
}

const scopedHosts = new WeakMap<object, Map<string, DragHost>>();

/** Independent gesture/data state for pages with more than one selector. */
export function scopedGlassDragHost(host: DragHost, dataKey: string): DragHost {
  let scopes = scopedHosts.get(host);
  if (!scopes) {
    scopes = new Map();
    scopedHosts.set(host, scopes);
  }
  let scoped = scopes.get(dataKey);
  if (!scoped) {
    scoped = {
      setData: (data) => host.setData({ [dataKey]: data }),
      createSelectorQuery: () => host.createSelectorQuery(),
    };
    scopes.set(dataKey, scoped);
  }
  return scoped;
}

interface SelectorOptions {
  enabled: boolean;
  index: number;
  count: number;
  selector: string;
  insetRpx: number;
  widthRpx: number;
}

interface SelectorDrag {
  id: number;
  x: number;
  y: number;
  dx: number;
  index: number;
  count: number;
  cell: number;
  dragged: boolean;
  cancelled: boolean;
}

const drags = new WeakMap<object, SelectorDrag>();
const suppressedTaps = new WeakSet<object>();
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

export function startGlassDrag(
  host: DragHost,
  event: WechatMiniprogram.TouchEvent,
  options: SelectorOptions,
) {
  suppressedTaps.delete(host);
  if (!options.enabled || event.touches.length !== 1) return;
  const touch = event.touches[0];
  const { x, y } = touchPoint(touch);
  const ratio = wx.getWindowInfo().windowWidth / 750;
  const drag: SelectorDrag = {
    id: touch.identifier,
    x,
    y,
    dx: 0,
    index: options.index,
    count: options.count,
    cell: ((options.widthRpx - 2 * options.insetRpx) * ratio) / options.count,
    dragged: false,
    cancelled: false,
  };
  drags.set(host, drag);
  // Measure the rendered track, so narrow screens and layout changes keep 1:1 tracking.
  host
    .createSelectorQuery()
    .select(options.selector)
    .boundingClientRect((result) => {
      if (
        drags.get(host) !== drag ||
        drag.cancelled ||
        Array.isArray(result) ||
        !result?.width
      )
        return;
      drag.cell = (result.width - 2 * options.insetRpx * ratio) / options.count;
      if (drag.dragged) renderDrag(host, drag);
    })
    .exec();
}

function renderDrag(host: DragHost, drag: SelectorDrag) {
  const position = clamp(drag.index + drag.dx / drag.cell, drag.count - 1);
  host.setData({
    selectorDragging: true,
    selectorDragIndex: Math.round(position),
    selectorDragStyle: `transform: translateX(${position * 100}%); transition-duration: 0ms;`,
  });
}

export function moveGlassDrag(
  host: DragHost,
  event: WechatMiniprogram.TouchEvent,
) {
  const drag = drags.get(host);
  if (!drag || drag.cancelled) return;
  const touch = event.touches.find((point) => point.identifier === drag.id);
  if (event.touches.length !== 1 || !touch) return cancelGlassDrag(host);
  const { x, y } = touchPoint(touch);
  const dx = x - drag.x;
  if (
    !drag.dragged &&
    Math.abs(y - drag.y) > 8 &&
    Math.abs(y - drag.y) > Math.abs(dx)
  ) {
    return cancelGlassDrag(host);
  }
  if (Math.abs(dx) > 4) drag.dragged = true;
  drag.dx = dx;
  if (drag.dragged) renderDrag(host, drag);
}

/** Returns a selection only on release; dragging never navigates or saves. */
export function endGlassDrag(
  host: DragHost,
  event: WechatMiniprogram.TouchEvent,
): number | undefined {
  const drag = drags.get(host);
  if (!drag) return;
  drags.delete(host);
  host.setData({
    selectorDragging: false,
    selectorDragIndex: -1,
    selectorDragStyle: "",
  });
  if (drag.cancelled || drag.dragged) suppressedTaps.add(host);
  if (drag.cancelled || !drag.dragged) return;
  const touch = event.changedTouches.find(
    (point) => point.identifier === drag.id,
  );
  if (!touch) return;
  return Math.round(
    clamp(
      drag.index + (touchPoint(touch).x - drag.x) / drag.cell,
      drag.count - 1,
    ),
  );
}

export function cancelGlassDrag(host: DragHost) {
  const drag = drags.get(host);
  if (!drag) return;
  drag.cancelled = true;
  suppressedTaps.add(host);
  host.setData({
    selectorDragging: false,
    selectorDragIndex: -1,
    selectorDragStyle: "",
  });
}

export function consumeGlassTap(host: object): boolean {
  const suppressed = suppressedTaps.has(host);
  suppressedTaps.delete(host);
  return suppressed;
}

export const GLASS_DRAG_DATA = {
  selectorDragging: false,
  selectorDragIndex: -1,
  selectorDragStyle: "",
};
