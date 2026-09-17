import {
  MAX_NAVIGATION,
  MIN_NAVIGATION,
  type NavigationId,
} from "../../store/navigation";
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export type DropIntent =
  | { kind: "none" | "blocked" | "locked" }
  | { kind: "insert" | "replace" | "reorder" | "remove"; index: number };
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export function dropIntent(input: {
  id: NavigationId;
  items: NavigationId[];
  x: number;
  y: number;
  nav: Rect;
  available: Rect;
  viewport: Rect;
  rowHeight: number;
  availableCount: number;
  previous: DropIntent;
}): DropIntent {
  const { id, items, x, y, nav, available, viewport, previous } = input;
  const fromNav = items.includes(id);
  if (
    x >= nav.left - 10 &&
    x <= nav.left + nav.width + 10 &&
    y >= nav.top - 15 &&
    y <= nav.top + nav.height + 17
  ) {
    const count = fromNav
      ? items.length
      : Math.min(MAX_NAVIGATION, items.length + 1);
    const width = nav.width / count;
    let index = clamp(Math.floor((x - nav.left) / width), 0, count - 1);
    if (
      ["insert", "replace", "reorder"].includes(previous.kind) &&
      "index" in previous &&
      Math.abs(previous.index - index) === 1 &&
      Math.abs(x - nav.left - Math.max(previous.index, index) * width) < 5
    )
      index = previous.index;
    if (
      !fromNav &&
      items.length === MAX_NAVIGATION &&
      items[index] === "profile"
    )
      return { kind: "locked" };
    return {
      kind: fromNav
        ? "reorder"
        : items.length < MAX_NAVIGATION
          ? "insert"
          : "replace",
      index,
    };
  }
  if (fromNav && id === "profile") return { kind: "locked" };
  if (
    fromNav &&
    x >= viewport.left &&
    x <= viewport.left + viewport.width &&
    y >= viewport.top &&
    y <= viewport.top + viewport.height
  ) {
    if (items.length <= MIN_NAVIGATION) return { kind: "blocked" };
    return {
      kind: "remove",
      index: clamp(
        Math.floor((y - available.top + input.rowHeight / 2) / input.rowHeight),
        0,
        input.availableCount,
      ),
    };
  }
  return { kind: "none" };
}
export function navigationAfterDrop(
  items: NavigationId[],
  id: NavigationId,
  intent: DropIntent,
): NavigationId[] {
  const next = [...items];
  if (
    (intent.kind === "remove" && id === "profile") ||
    (intent.kind === "replace" && items[intent.index] === "profile")
  )
    return next;
  if (intent.kind === "insert") next.splice(intent.index, 0, id);
  if (intent.kind === "replace") next[intent.index] = id;
  if (intent.kind === "reorder") {
    next.splice(next.indexOf(id), 1);
    next.splice(intent.index, 0, id);
  }
  if (intent.kind === "remove") next.splice(next.indexOf(id), 1);
  return next;
}
