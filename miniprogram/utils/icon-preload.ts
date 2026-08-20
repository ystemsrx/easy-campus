import type { TimetableThemeId } from "../data/timetable-theme";

const PRIMARY_TAB_ASSET_PATHS = [
  "/assets/icons/arrow-left-white.svg",
  "/assets/icons/calendar-days-ink.svg",
  "/assets/icons/calendar-days-muted.svg",
  "/assets/icons/calendar-days-white.svg",
  "/assets/icons/check-white.svg",
  "/assets/icons/chevron-right-muted.svg",
  "/assets/icons/chevron-right-white.svg",
  "/assets/icons/home-ink.svg",
  "/assets/icons/home-muted.svg",
  "/assets/icons/home-white.svg",
  "/assets/icons/inbox-white.svg",
  "/assets/icons/log-out-danger.svg",
  "/assets/icons/plus-white.svg",
  "/assets/icons/sparkles-rose.svg",
  "/assets/icons/user-round-ink.svg",
  "/assets/icons/user-round-muted.svg",
  "/assets/icons/user-round-white.svg",
  "/assets/images/schedule-dashed-corner-24.svg",
  "/assets/images/schedule-dashed-corner-30.svg",
] as const;

const PRELOAD_CONCURRENCY = 4;
let preloadStarted = false;
const preloadedTimetableThemes = new Set<TimetableThemeId>();
const TIMETABLE_THEME_FIRST_SCREEN_ASSETS: Partial<
  Record<TimetableThemeId, readonly string[]>
> = {
  default: ["/assets/images/timetable-theme-default-background.jpg"],
  clawd: [
    "/assets/images/timetable-theme-clawd-background.jpg",
    "/assets/images/timetable-theme-clawd-idle.svg",
  ],
};

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

/** 只预热主 Tab 首屏资源，避免启动阶段遍历数百个未显示的 SVG。 */
export function preloadPrimaryTabAssets(): void {
  if (preloadStarted) return;
  preloadStarted = true;
  const paths = [...PRIMARY_TAB_ASSET_PATHS];
  let cursor = 0;
  const worker = async () => {
    while (cursor < paths.length) {
      const path = paths[cursor];
      cursor += 1;
      await warmImage(path);
    }
  };
  void Promise.all(Array.from({ length: PRELOAD_CONCURRENCY }, () => worker()));
}

/** 只解码当前课表主题首帧会实际使用的图片。 */
export function preloadTimetableThemeAssets(themeId: TimetableThemeId): void {
  if (preloadedTimetableThemes.has(themeId)) return;
  preloadedTimetableThemes.add(themeId);
  const paths = TIMETABLE_THEME_FIRST_SCREEN_ASSETS[themeId] || [];
  void Promise.all(paths.map((path) => warmImage(path)));
}
