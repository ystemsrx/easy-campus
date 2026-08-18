export function progressRingSource(
  value: number | null,
  animate = true,
): string {
  const clampedValue =
    value === null || !Number.isFinite(value)
      ? 0
      : Math.max(0, Math.min(100, value));
  const progress = Number(clampedValue.toFixed(2));
  const circumference = 2 * Math.PI * 42;
  const progressLength = Number(
    ((circumference * progress) / 100).toFixed(2),
  );
  const remainderLength = Number(
    (circumference - progressLength).toFixed(2),
  );
  const progressOpacity = progress > 0 ? 1 : 0;
  const animation =
    animate && progress > 0
      ? `<animate attributeName="stroke-dasharray" from="0 ${Number(circumference.toFixed(2))}" to="${progressLength} ${remainderLength}" dur=".72s" calcMode="spline" keyTimes="0;1" keySplines=".22 1 .36 1" fill="freeze"/>`
      : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<circle cx="50" cy="50" r="42" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="8.67"/>` +
    `<circle cx="50" cy="50" r="42" fill="none" stroke="#fff" stroke-width="8.67" stroke-linecap="round" stroke-dasharray="${progressLength} ${remainderLength}" stroke-opacity="${progressOpacity}" transform="rotate(-90 50 50)">${animation}</circle>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
