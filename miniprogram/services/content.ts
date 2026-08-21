import { getApiUrl } from "../config/index";
import { captureSessionLease, isSessionLeaseCurrent } from "../store/session";
import type { PublicationFeed, PublicationMedia } from "../types/api";
import { apiRequest } from "./request";

const mediaCache = new Map<string, string>();

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

  return new Promise((resolve) => {
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
          mediaCache.set(cacheKey, response.tempFilePath);
          resolve(response.tempFilePath);
          return;
        }
        resolve(null);
      },
      fail: () => resolve(null),
    });
  });
}
