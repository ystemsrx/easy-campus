import { APP_NAME } from "../config/app";

const COVER_ASSET = "/assets/share/app-cover.jpg";
const TIMELINE_COVER_ASSET = "/assets/share/timeline-cover.jpg";
const localCovers: Record<string, string> = {};

function nativeCover(asset: string, fileName: string): string {
  if (localCovers[fileName]) return localCovers[fileName];
  try {
    // The native share preview may not resolve a code-package URL even when
    // getImageInfo can. Materialize the small, ready JPEG once per app launch.
    // Always replace the previous launch's copy so app updates get new artwork.
    // Version the filename when the art changes to invalidate native thumbnails.
    const target = `${wx.env.USER_DATA_PATH}/${fileName}`;
    wx.getFileSystemManager().copyFileSync(asset.slice(1), target);
    localCovers[fileName] = target;
    return target;
  } catch {
    // Packaged images are supported by native sharing if local storage fails.
    return asset;
  }
}

// Use a packaged cover and public entry point on every page, including private
// detail screens. WeChat must never fall back to a screenshot or current query.
export function buildAppShare(): WechatMiniprogram.Page.ICustomShareContent {
  return {
    title: `${APP_NAME} · 便利校园`,
    path: "/pages/home/index",
    imageUrl: nativeCover(COVER_ASSET, "app-share-cover-v2.jpg"),
  };
}

// Timeline shares open the current page. Keep its query empty so invite codes
// and other incoming parameters are never copied into a public post.
export function buildTimelineShare(): WechatMiniprogram.Page.ICustomTimelineContent {
  return {
    title: `${APP_NAME} · 便利校园`,
    query: "",
    imageUrl: nativeCover(TIMELINE_COVER_ASSET, "timeline-share-cover-v1.jpg"),
  };
}

export function enableTimelineShare(): void {
  wx.showShareMenu?.({ menus: ["shareAppMessage", "shareTimeline"] });
}

export function buildCompanionShare(code: string): WechatMiniprogram.Page.ICustomShareContent {
  return {
    title: "邀请你成为我的上课搭子",
    path: `/pages/home/index?companionCode=${encodeURIComponent(code)}`,
    imageUrl: nativeCover(COVER_ASSET, "app-share-cover-v2.jpg"),
  };
}
