/** The server exposes a duration only after its confidence gate; never infer one locally. */
export function departureLabel(
  seconds: number | null | undefined,
  ageSeconds = 0,
): string {
  if (
    seconds == null ||
    !Number.isFinite(seconds) ||
    ageSeconds < 0 ||
    ageSeconds > 90 ||
    seconds - ageSeconds < 30 ||
    seconds - ageSeconds > 3600
  )
    return "等候中";
  return `预计 ${Math.max(1, Math.ceil((seconds - ageSeconds) / 60))} 分钟后出发`;
}
