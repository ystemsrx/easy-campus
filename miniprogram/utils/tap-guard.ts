export interface TapPoint {
  x: number;
  y: number;
}

export const TAP_MOVE_THRESHOLD_PX = 8;
export const SCROLL_TAP_SETTLE_MS = 160;

export function movementExceedsTapThreshold(
  start: TapPoint,
  current: TapPoint,
): boolean {
  const deltaX = current.x - start.x;
  const deltaY = current.y - start.y;
  return (
    deltaX * deltaX + deltaY * deltaY >=
    TAP_MOVE_THRESHOLD_PX * TAP_MOVE_THRESHOLD_PX
  );
}

export function canActivateTap(
  moved: boolean,
  lastScrollAt: number,
  now = Date.now(),
): boolean {
  if (moved) return false;
  return lastScrollAt <= 0 || now - lastScrollAt >= SCROLL_TAP_SETTLE_MS;
}
