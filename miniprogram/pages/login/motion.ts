export const LAPTOP_DURATION_MS = 3580;
export const LURKING_DURATION_MS = 5580;
export const CRABWALKING_LEG_MS = 1660;
export const WAVING_DURATION_MS = 1410;
export const LOGIN_ROUTE_LEAD_MS = 100;
export const MAX_LOGIN_HANDOFF_DELAY_MS = 120;

const CRABWALKING_STILL_RATIO = 0.199;
const CRABWALKING_DISTANCE_RPX = 380;

export function resolveWalkingPositionRpx(
  startLeftRpx: number,
  elapsedMs: number,
): number {
  const cycleProgress = Math.min(
    1,
    Math.max(0, elapsedMs) / CRABWALKING_LEG_MS,
  );
  const movementProgress =
    cycleProgress <= CRABWALKING_STILL_RATIO
      ? 0
      : (cycleProgress - CRABWALKING_STILL_RATIO) /
        (1 - CRABWALKING_STILL_RATIO);
  return startLeftRpx + CRABWALKING_DISTANCE_RPX * movementProgress;
}

export function resolveLoginHandoffDelay(
  submitStartedAt: number,
  now: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion) {
    return 0;
  }
  const elapsed = Math.max(0, now - submitStartedAt);
  const remaining = Math.max(0, WAVING_DURATION_MS - elapsed);
  return Math.min(
    MAX_LOGIN_HANDOFF_DELAY_MS,
    Math.max(0, remaining - LOGIN_ROUTE_LEAD_MS),
  );
}
