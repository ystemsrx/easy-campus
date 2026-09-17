export type NavigationId =
  "home" | "schedule" | "profile" | "timetable" | "passrate" | "rooms";
export interface NavigationItem {
  id: NavigationId;
  text: string;
  icon: string;
  pagePath: string;
  native: boolean;
  description: string;
}
export const NAVIGATION_ITEMS: NavigationItem[] = [
  {
    id: "home",
    text: "概览",
    icon: "home",
    pagePath: "/pages/home/index",
    native: true,
    description: "校园日常",
  },
  {
    id: "schedule",
    text: "日程",
    icon: "calendar-days",
    pagePath: "/pages/schedule/index",
    native: true,
    description: "待办与安排",
  },
  {
    id: "profile",
    text: "我的",
    icon: "user-round",
    pagePath: "/pages/profile/index",
    native: true,
    description: "个人信息与设置",
  },
  {
    id: "timetable",
    text: "课表",
    icon: "calendar-days",
    pagePath: "/features/pages/timetable/index",
    native: false,
    description: "每周课程",
  },
  {
    id: "passrate",
    text: "通过率",
    icon: "chart-no-axes-column-increasing",
    pagePath: "/features/pages/pass-rates/index",
    native: false,
    description: "课程成绩分布",
  },
  {
    id: "rooms",
    text: "空教室",
    icon: "door-open",
    pagePath: "/features/pages/rooms/index",
    native: false,
    description: "空闲教室查询",
  },
];
export const DEFAULT_NAVIGATION: NavigationId[] = [
  "home",
  "schedule",
  "profile",
];
export const MIN_NAVIGATION = 3;
export const MAX_NAVIGATION = 4;
export interface NavigationSettings {
  items: NavigationId[];
  displaced: Partial<Record<NavigationId, NavigationId>>;
}
const KEY = "easy-swu:navigation:v1";
const listeners = new Set<() => void>();
export function navigationItem(id: NavigationId): NavigationItem {
  return NAVIGATION_ITEMS.find((item) => item.id === id)!;
}
export function validNavigation(items: unknown): items is NavigationId[] {
  return (
    Array.isArray(items) &&
    items.length >= MIN_NAVIGATION &&
    items.length <= MAX_NAVIGATION &&
    items.includes("profile") &&
    new Set(items).size === items.length &&
    items.every((id) => NAVIGATION_ITEMS.some((item) => item.id === id))
  );
}
/** Keep a displaced native page in the incoming feature's home slot, including add-then-remove edits. */
export function reconcileNavigation(
  previous: NavigationSettings,
  items: NavigationId[],
  incoming?: NavigationId,
  outgoing?: NavigationId,
): NavigationSettings {
  if (!validNavigation(items))
    return { items: [...previous.items], displaced: { ...previous.displaced } };
  const displaced: NavigationSettings["displaced"] = {};
  const missing = DEFAULT_NAVIGATION.filter((id) => !items.includes(id));
  const extras = items.filter((id) => !navigationItem(id).native);
  if (missing.includes("schedule")) {
    const slot = items.find((id) => id === "rooms" || id === "timetable");
    if (slot) displaced[slot] = "schedule";
  }
  if (incoming && extras.includes(incoming) && outgoing) {
    const recovered = navigationItem(outgoing).native
      ? outgoing
      : previous.displaced[outgoing];
    if (
      recovered &&
      missing.includes(recovered) &&
      !displaced[incoming] &&
      !Object.values(displaced).includes(recovered)
    )
      displaced[incoming] = recovered;
  }
  for (const extra of extras) {
    const old = previous.displaced[extra];
    if (
      !displaced[extra] &&
      old &&
      missing.includes(old) &&
      !Object.values(displaced).includes(old)
    )
      displaced[extra] = old;
  }
  for (const id of missing) {
    if (Object.values(displaced).includes(id)) continue;
    const slot = extras.find((extra) => !displaced[extra]);
    if (slot) displaced[slot] = id;
  }
  return { items: [...items], displaced };
}
export function loadNavigation(): NavigationSettings {
  const fallback: NavigationSettings = {
    items: [...DEFAULT_NAVIGATION],
    displaced: {},
  };
  try {
    const stored = wx.getStorageSync(KEY) as NavigationSettings | undefined;
    if (!stored || !validNavigation(stored.items)) return fallback;
    return reconcileNavigation(
      { items: stored.items, displaced: stored.displaced || {} },
      stored.items,
    );
  } catch {
    return fallback;
  }
}
export function saveNavigation(value: NavigationSettings): void {
  if (!validNavigation(value.items)) throw new Error("Invalid navigation");
  wx.setStorageSync(KEY, reconcileNavigation(value, value.items));
  listeners.forEach((listener) => listener());
}
export function subscribeNavigation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function navigationIndex(id: NavigationId): number {
  return loadNavigation().items.indexOf(id);
}
export function homeNavigationActions(
  settings = loadNavigation(),
): NavigationItem[] {
  const actions = (["passrate", "rooms"] as NavigationId[]).map((slot) =>
    navigationItem(settings.displaced[slot] || slot),
  );
  if (settings.displaced.timetable)
    actions.push(navigationItem(settings.displaced.timetable));
  return actions;
}
