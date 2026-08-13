import { getApiBaseUrl } from "../config/index";
import { getSession } from "../store/session";
import type { PublicationFeed, PublicationMedia } from "../types/api";
import { apiRequest } from "./request";

const mediaCache = new Map<string, string>();

export function getPublicationFeed(): Promise<PublicationFeed> {
  return apiRequest<PublicationFeed>("/api/v1/content/feed");
}

export function markPublicationRead(
  publicationId: string,
): Promise<{ read: true; readAt: string }> {
  return apiRequest<{ read: true; readAt: string }>(
    `/api/v1/content/publications/${publicationId}/read`,
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
    `/api/v1/content/publications/${publicationId}/popup`,
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
  const cached = mediaCache.get(media.id);
  if (cached) return Promise.resolve(cached);
  const session = getSession();
  if (!session) return Promise.resolve(null);

  return new Promise((resolve) => {
    wx.downloadFile({
      url: `${getApiBaseUrl()}${media.url}`,
      header: {
        Authorization: `Bearer ${session.token}`,
      },
      timeout: 30000,
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          mediaCache.set(media.id, response.tempFilePath);
          resolve(response.tempFilePath);
          return;
        }
        resolve(null);
      },
      fail: () => resolve(null),
    });
  });
}
