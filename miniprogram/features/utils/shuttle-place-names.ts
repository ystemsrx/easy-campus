import type { NamedPoint, ShuttlePlace } from "../../types/shuttle";

/** Old cached maps and manually chosen points may not yet carry a short name. */
export function placeShortName(place: NamedPoint): string {
  const value =
    typeof place.shortName === "string" && place.shortName.trim()
      ? place.shortName.trim()
      : place.name.split(" · ")[0].trim();
  return Array.from(value).slice(0, 4).join("");
}
export function matchesPlace(place: ShuttlePlace, query: string): boolean {
  const normalize = (value: string): string =>
    value.normalize("NFKC").toLowerCase().replace(/\s/g, "");
  const needle = normalize(query);
  if (!needle) return true;
  return [
    place.name,
    place.shortName || "",
    ...(Array.isArray(place.aliases) ? place.aliases : []),
  ].some(
    (value) => typeof value === "string" && normalize(value).includes(needle),
  );
}
