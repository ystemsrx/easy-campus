import type { WatermarkPayload } from "../services/watermark";
import {
  WATERMARK_GRID_SIZE,
  createWatermarkPacket,
  createWatermarkTileSigns,
  hexToBytes,
} from "./watermark-core";

const POSITIVE_COLOR = "#d27d46";
const NEGATIVE_COLOR = "#469bd2";

export function createScreenWatermarkSource(
  payload: WatermarkPayload,
  width: number,
  height: number,
  pixelRatio: number,
): string {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const safePixelRatio = Math.min(4, Math.max(1, Number(pixelRatio) || 1));
  const cellSize = Math.min(12, Math.max(6, Math.round(payload.cellSize)));
  const strength = Math.min(0.08, Math.max(0.015, payload.strength));
  const signs = createWatermarkTileSigns(
    createWatermarkPacket(hexToBytes(payload.token), payload.type),
  );
  const positiveCells: string[] = [];
  const negativeCells: string[] = [];

  for (let row = 0; row < WATERMARK_GRID_SIZE; row += 1) {
    for (let column = 0; column < WATERMARK_GRID_SIZE; column += 1) {
      const x = column * cellSize;
      const y = row * cellSize;
      const command = `M${x} ${y}h${cellSize}v${cellSize}H${x}z`;
      const target =
        signs[row * WATERMARK_GRID_SIZE + column] > 0
          ? positiveCells
          : negativeCells;
      target.push(command);
    }
  }

  const tileSize = WATERMARK_GRID_SIZE * cellSize;
  const intrinsicWidth = Math.round(safeWidth * safePixelRatio);
  const intrinsicHeight = Math.round(safeHeight * safePixelRatio);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${intrinsicWidth}" height="${intrinsicHeight}" ` +
    `viewBox="0 0 ${safeWidth} ${safeHeight}" preserveAspectRatio="none" shape-rendering="crispEdges">` +
    `<defs>` +
    `<pattern id="a" width="4" height="4" patternUnits="userSpaceOnUse">` +
    `<path d="M0 0h4v4H0z" fill="${NEGATIVE_COLOR}"/>` +
    `<path d="M0 0h2v2H0zM2 2h2v2H2z" fill="${POSITIVE_COLOR}"/>` +
    `</pattern>` +
    `<pattern id="b" width="4" height="4" patternUnits="userSpaceOnUse">` +
    `<path d="M0 0h4v4H0z" fill="${POSITIVE_COLOR}"/>` +
    `<path d="M0 0h2v2H0zM2 2h2v2H2z" fill="${NEGATIVE_COLOR}"/>` +
    `</pattern>` +
    `<pattern id="t" width="${tileSize}" height="${tileSize}" patternUnits="userSpaceOnUse">` +
    `<path d="${positiveCells.join("")}" fill="url(#a)"/>` +
    `<path d="${negativeCells.join("")}" fill="url(#b)"/>` +
    `</pattern>` +
    `</defs>` +
    `<path d="M0 0H${safeWidth}V${safeHeight}H0z" fill="url(#t)" opacity="${strength}"/>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
