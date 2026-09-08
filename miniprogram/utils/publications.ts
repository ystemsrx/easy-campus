import type { Publication } from "../types/api";

export function resolvePublicationPanelHeight(
  windowWidth: number,
  windowHeight: number,
  contentHeight = 0,
  chromeHeight = 0,
): number {
  const rpx = windowWidth / 750;
  const maximum = Math.floor(Math.min(680 * rpx, windowHeight * 0.62));
  const desired = Math.ceil(Math.max(380 * rpx, contentHeight + chromeHeight));
  return Math.max(1, Math.min(maximum, desired));
}

function publicationTimestamp(publication: Publication): number {
  const startsAt = Date.parse(publication.startsAt);
  if (Number.isFinite(startsAt)) return startsAt;
  const createdAt = Date.parse(publication.createdAt);
  return Number.isFinite(createdAt) ? createdAt : 0;
}

export function sortPublicationsNewestFirst(
  publications: Publication[],
): Publication[] {
  return [...publications].sort((left, right) => {
    const timeDifference =
      publicationTimestamp(right) - publicationTimestamp(left);
    if (timeDifference) return timeDifference;
    const createdDifference = right.createdAt.localeCompare(left.createdAt);
    return createdDifference || right.id.localeCompare(left.id);
  });
}
