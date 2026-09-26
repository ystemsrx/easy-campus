import type {
  CampusShuttleMap,
  GeoPoint,
  ShuttlePlace,
} from "../../types/shuttle";
import { distanceMeters } from "../../utils/shuttle-geo";
import { matchesPlace, placeShortName } from "./shuttle-place-names";

export interface ShuttlePlaceGroup {
  id: string;
  name: string;
  shortName: string;
  members: ShuttlePlace[];
  stop: boolean;
}
export function stopName(place: ShuttlePlace): string {
  return place.name
    .replace(/\s*[·•]?\s*(?:东|南|西|北|东北|东南|西北|西南)行\s*$/, "")
    .trim();
}
export function placeGroups(map: CampusShuttleMap): ShuttlePlaceGroup[] {
  const groups: ShuttlePlaceGroup[] = [];
  for (const place of map.places) {
    const stop = place.category === "stop";
    const existing =
      stop &&
      groups.find(
        (g) =>
          g.stop &&
          g.members.some((p) => {
            const distance = distanceMeters(p, place);
            // The source also has overlapping stops with different labels on different routes.
            return (
              distance <= 8 ||
              (placeShortName(p) === placeShortName(place) && distance <= 250)
            );
          }),
      );
    if (existing) {
      existing.members.push(place);
      const label = [...existing.members].sort(
        (a, b) =>
          placeShortName(a).length - placeShortName(b).length ||
          stopName(a).length - stopName(b).length,
      )[0];
      existing.name = stopName(label);
      existing.shortName = placeShortName(label);
    } else
      groups.push({
        id: place.id,
        name: stop ? stopName(place) : place.name,
        shortName: placeShortName(place),
        members: [place],
        stop,
      });
  }
  return groups;
}
export function findPlaceGroups(
  map: CampusShuttleMap,
  query: string,
  board: boolean,
  origin?: GeoPoint,
): ShuttlePlaceGroup[] {
  return placeGroups(map)
    .filter(
      (g) =>
        (!board || g.stop) && g.members.some((p) => matchesPlace(p, query)),
    )
    .sort(
      (a, b) =>
        Number(b.stop) - Number(a.stop) ||
        (origin
          ? Math.min(...a.members.map((p) => distanceMeters(origin, p))) -
            Math.min(...b.members.map((p) => distanceMeters(origin, p)))
          : a.shortName.localeCompare(b.shortName)),
    );
}
