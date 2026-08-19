import type { Publication } from "../types/api";

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
