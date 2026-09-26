import type { GeoPoint } from "../../types/shuttle";
export function headingDegrees(a: GeoPoint, b: GeoPoint): number {
  const dy = b.latitude - a.latitude,
    dx = (b.longitude - a.longitude) * Math.cos((a.latitude * Math.PI) / 180);
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}
export function mercatorLatitude(latitude: number): number {
  return Math.log(
    Math.tan(
      Math.PI / 4 + (Math.max(-85, Math.min(85, latitude)) * Math.PI) / 360,
    ),
  );
}
export interface ScreenPoint {
  x: number;
  y: number;
}
export interface ScreenRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export function projectToScreen(
  point: GeoPoint,
  bounds: { southwest: GeoPoint; northeast: GeoPoint },
  width: number,
  height: number,
): ScreenPoint {
  const north = mercatorLatitude(bounds.northeast.latitude),
    south = mercatorLatitude(bounds.southwest.latitude);
  return {
    x:
      ((point.longitude - bounds.southwest.longitude) /
        (bounds.northeast.longitude - bounds.southwest.longitude)) *
      width,
    y: ((north - mercatorLatitude(point.latitude)) / (north - south)) * height,
  };
}
export function edgeIntersection(
  point: ScreenPoint,
  rect: ScreenRect,
): ScreenPoint | null {
  if (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  )
    return null;
  const cx = (rect.left + rect.right) / 2,
    cy = (rect.top + rect.bottom) / 2,
    dx = point.x - cx,
    dy = point.y - cy;
  const tx =
    dx > 0 ? (rect.right - cx) / dx : dx < 0 ? (rect.left - cx) / dx : Infinity;
  const ty =
    dy > 0 ? (rect.bottom - cy) / dy : dy < 0 ? (rect.top - cy) / dy : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}
