import { APP_NAME } from "../config/app";

const COVER_ASSET = "/assets/share/app-cover.jpg";
let localCover = "";

function nativeCover(): string {
  if (localCover) return localCover;
  try {
    // The native share preview may not resolve a code-package URL even when
    // getImageInfo can. Materialize the small, ready JPEG once per app launch.
    // Always replace the previous launch's copy so app updates get new artwork.
    // Version the filename when the art changes to invalidate native thumbnails.
    const target = `${wx.env.USER_DATA_PATH}/app-share-cover-v2.jpg`;
    wx.getFileSystemManager().copyFileSync(COVER_ASSET.slice(1), target);
    localCover = target;
    return target;
  } catch {
    // Packaged images are supported by onShareAppMessage if local storage fails.
    return COVER_ASSET;
  }
}

// Use a packaged cover and public entry point on every page, including private
// detail screens. WeChat must never fall back to a screenshot or current query.
export function buildAppShare(): WechatMiniprogram.Page.ICustomShareContent {
  return {
    title: `${APP_NAME} · 便利校园`,
    path: "/pages/home/index",
    imageUrl: nativeCover(),
  };
}
