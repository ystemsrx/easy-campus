import { getApiUrl } from "../config/index";
import { captureSessionLease, isSessionLeaseCurrent } from "../store/session";
import type { PublicationFeed, PublicationMedia } from "../types/api";
import { apiRequest } from "./request";

const mediaCache = new Map<string, string>();
const mediaPreloads = new Map<string, Promise<string | null>>();
const IMAGE_DECODE_TIMEOUT_MS = 5_000;

export function getPublicationFeed(): Promise<PublicationFeed> {
  return apiRequest<PublicationFeed>("/content/feed");
}

export function markPublicationRead(
  publicationId: string,
): Promise<{ read: true; readAt: string }> {
  return apiRequest<{ read: true; readAt: string }>(
    `/content/publications/${publicationId}/read`,
    {
      method: "POST",
      data: {},
      retry: false,
    },
  );
}

export function recordAnnouncementPopup(
  publicationId: string,
): Promise<{ recorded: true }> {
  return apiRequest<{ recorded: true }>(
    `/content/publications/${publicationId}/popup`,
    {
      method: "POST",
      data: {},
      retry: false,
    },
  );
}

export function downloadPublicationMedia(
  media: PublicationMedia,
): Promise<string | null> {
  const lease = captureSessionLease();
  if (!lease) return Promise.resolve(null);
  const cacheKey = `${lease.userId}:${media.id}`;
  const cached = mediaCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  const inFlight = mediaPreloads.get(cacheKey);
  if (inFlight) return inFlight;

  const pending = new Promise<string | null>((resolve) => {
    try {
      wx.downloadFile({
        url: getApiUrl(media.url),
        header: {
          Authorization: `Bearer ${lease.token}`,
        },
        timeout: 30000,
        success: (response) => {
          if (!isSessionLeaseCurrent(lease)) {
            resolve(null);
            return;
          }
          if (response.statusCode >= 200 && response.statusCode < 300) {
            preloadLocalImage(response.tempFilePath).then((ready) => {
              if (!ready || !isSessionLeaseCurrent(lease)) {
                resolve(null);
                return;
              }
              mediaCache.set(cacheKey, response.tempFilePath);
              resolve(response.tempFilePath);
            });
            return;
          }
          resolve(null);
        },
        fail: () => resolve(null),
      });
    } catch {
      resolve(null);
    }
  });
  mediaPreloads.set(cacheKey, pending);
  void pending.finally(() => {
    if (mediaPreloads.get(cacheKey) === pending) {
      mediaPreloads.delete(cacheKey);
    }
  });
  return pending;
}

export async function preloadPublicationMedia(
  media: PublicationMedia[],
): Promise<Record<string, string>> {
  const downloaded = await Promise.all(
    media.map(async (asset) => ({
      id: asset.id.toLowerCase(),
      path: await downloadPublicationMedia(asset),
    })),
  );
  const mediaUrls: Record<string, string> = {};
  for (const asset of downloaded) {
    if (asset.path) mediaUrls[asset.id] = asset.path;
  }
  return mediaUrls;
}

function preloadLocalImage(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(ready);
    };
    const timeout = setTimeout(
      () => finish(false),
      IMAGE_DECODE_TIMEOUT_MS,
    );
    try {
      wx.getImageInfo({
        src: path,
        success: () => finish(true),
        fail: () => finish(false),
      });
    } catch {
      finish(false);
    }
  });
}
