/** One continuous capsule outline. The interior is genuinely transparent. */
export const CAPSULE_RIM_WIDTH = 6;
export const CAPSULE_RIM_SCALE = 1.06;

export function capsuleRimMask(width: number, height: number): string {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < height ||
    height <= CAPSULE_RIM_WIDTH * 2
  )
    throw new Error("Invalid capsule dimensions");
  const t = CAPSULE_RIM_WIDTH;
  // All strokes share the same centreline and only paint one static alpha mask.
  // They never create additional WXML scenes or independently transformed slices.
  // Source-over increments approximate a smooth fade at BOTH edges, so the
  // uniformly enlarged replica does not end in an opaque cut against the page.
  const steps = 12;
  let opacity = 0;
  const strokes: string[] = [];
  for (let i = 0; i < steps; i++) {
    const progress = (i + 0.5) / steps;
    const target = progress * progress * (3 - 2 * progress);
    const increment = (target - opacity) / (1 - opacity);
    const strokeWidth = t * (1 - i / steps);
    strokes.push(
      `<rect x="${t / 2}" y="${t / 2}" width="${width - t}" height="${height - t}" rx="${(height - t) / 2}" fill="none" stroke="white" stroke-width="${strokeWidth}" stroke-opacity="${increment.toFixed(6)}"/>`,
    );
    opacity = target;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${strokes.join("")}</svg>`;
  return `mask-image:url("data:image/svg+xml,${encodeURIComponent(svg)}");mask-size:100% 100%;mask-repeat:no-repeat;`;
}
