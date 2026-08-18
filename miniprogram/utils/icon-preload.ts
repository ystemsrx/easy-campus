const ICON_NAMES = [
  "arrow-left",
  "bell",
  "book-open",
  "building-2",
  "calendar-check",
  "calendar-clock",
  "calendar-days",
  "calendar-range",
  "chart-no-axes-column-increasing",
  "check",
  "chevron-right",
  "circle-alert",
  "circle-check-big",
  "circle-help",
  "clipboard-check",
  "clock-3",
  "copy",
  "database",
  "door-open",
  "download",
  "external-link",
  "eye",
  "eye-off",
  "graduation-cap",
  "home",
  "inbox",
  "info",
  "list-filter",
  "lock-keyhole",
  "log-out",
  "map-pin",
  "megaphone",
  "message-circle-more",
  "notebook-tabs",
  "panel-top-open",
  "plus",
  "refresh-cw",
  "rotate-ccw",
  "school",
  "search",
  "server",
  "shield-check",
  "sparkles",
  "user-round",
  "x",
  "zap",
  "zoom-in",
] as const;

const ICON_TONES = [
  "ink",
  "muted",
  "white",
  "coral",
  "amber",
  "sage",
  "rose",
  "danger",
] as const;

const PRIORITY_PATHS = [
  "/assets/icons/arrow-left-white.svg",
  "/assets/icons/chevron-right-white.svg",
  "/assets/icons/home-white.svg",
  "/assets/icons/inbox-white.svg",
] as const;

const PRELOAD_CONCURRENCY = 6;
let preloadStarted = false;

function allIconPaths(): string[] {
  const paths = ICON_NAMES.flatMap((name) =>
    ICON_TONES.map((tone) => `/assets/icons/${name}-${tone}.svg`),
  );
  const priority = new Set<string>(PRIORITY_PATHS);
  return [...PRIORITY_PATHS, ...paths.filter((path) => !priority.has(path))];
}

function warmImage(path: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      wx.getImageInfo({
        src: path,
        complete: () => resolve(),
      });
    } catch {
      resolve();
    }
  });
}

/** 应用启动后低并发读取全部 SVG，使后续 image 首次绘制命中资源缓存。 */
export function preloadAllSvgIcons(): void {
  if (preloadStarted) return;
  preloadStarted = true;
  const paths = allIconPaths();
  let cursor = 0;
  const worker = async () => {
    while (cursor < paths.length) {
      const path = paths[cursor];
      cursor += 1;
      await warmImage(path);
    }
  };
  void Promise.all(
    Array.from({ length: PRELOAD_CONCURRENCY }, () => worker()),
  );
}
