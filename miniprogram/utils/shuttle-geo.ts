import type {
  CampusShuttleMap,
  GeoPoint,
  ShuttleMarker,
  ShuttlePolyline,
  ShuttleVehicle,
} from "../types/shuttle";
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * r) / 2) ** 2 +
    Math.cos(a.latitude * r) *
      Math.cos(b.latitude * r) *
      Math.sin(((b.longitude - a.longitude) * r) / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function distanceLabel(meters: number): string {
  return meters < 1000
    ? `${Math.round(meters / 10) * 10} 米`
    : `${(meters / 1000).toFixed(1)} 公里`;
}
export function roadPolylines(
  map: CampusShuttleMap,
  routeIds?: string[],
  preview = false,
): ShuttlePolyline[] {
  const lines: ShuttlePolyline[] = [];
  for (const path of map.paths) {
    const selected =
      !routeIds || path.routeIds.some((id) => routeIds.includes(id));
    lines.push({
      points: [...path.points],
      color: selected ? (preview ? "#35649B" : "#8CB0EF") : "#CCD5E2",
      width: selected ? (preview ? 2 : 4) : 1,
      dottedLine: false,
      borderWidth: 0,
    });
  }
  // Studio exports split shared roads at route boundaries. Join exact endpoints
  // for native rendering; never snap nearby roads or invent connecting segments.
  const same = (a: GeoPoint, b: GeoPoint): boolean =>
    a.longitude === b.longitude && a.latitude === b.latitude;
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    for (let j = i + 1; j < lines.length; j++) {
      const b = lines[j];
      if (a.color !== b.color || a.width !== b.width) continue;
      const first = a.points[0],
        last = a.points[a.points.length - 1];
      const start = b.points[0],
        end = b.points[b.points.length - 1];
      if (same(last, start)) a.points.push(...b.points.slice(1));
      else if (same(last, end))
        a.points.push(...b.points.slice(0, -1).reverse());
      else if (same(first, end)) a.points.unshift(...b.points.slice(0, -1));
      else if (same(first, start))
        a.points.unshift(...b.points.slice(1).reverse());
      else continue;
      lines.splice(j, 1);
      j = i; // The extended line may now meet an earlier candidate.
    }
  }
  // Draw muted roads first so selected routes remain visible at intersections.
  lines.sort((a, b) => a.width - b.width);
  // Paint all casings BELOW all centerlines. Per-polyline white borders would
  // cover previously drawn color at branch junctions and short segment joins.
  return [
    ...lines.map((line) => ({
      ...line,
      color: "#FFFFFF",
      width: line.width + 2,
    })),
    ...lines,
  ];
}
export function vehicleMarker(
  bus: ShuttleVehicle,
  id: number,
  size = 32,
): ShuttleMarker {
  return {
    id,
    longitude: bus.longitude,
    latitude: bus.latitude,
    iconPath: "/assets/shuttle/bus.png",
    width: size,
    height: size,
    anchor: { x: 0.5, y: 0.5 },
    zIndex: 1000 + (id % 1000),
    label: {
      content: (bus.vehicleNo || bus.id).slice(-5),
      color: "#38506D",
      fontSize: size < 30 ? 9 : 10,
      bgColor: "#FFFFFFE8",
      borderRadius: 6,
      padding: 3,
      anchorX: size / 2 + 2,
      anchorY: -9,
    },
  };
}
