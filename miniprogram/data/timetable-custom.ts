export const CUSTOM_COLORS = [
  "#b44c69", "#f1c9c1", "#d97757", "#743722", "#d2a04f",
  "#79c99c", "#58aaa3", "#0862ad", "#75508f", "#2e3033",
  "#f6d9d2", "#f5e7c9", "#dcebdc", "#d8eaf0", "#e7ddf0",
] as const;

const DEFAULT_CUSTOM_COLOR = "#0862ad";

export interface TimetableEdgeColors {
  top: string;
  bottom: string;
  left: string;
  right: string;
}

export interface CachedBackground {
  version: string;
  filePath: string;
  width: number;
  height: number;
  edges: TimetableEdgeColors;
}

function key(userId: string | number): string {
  return `easy-swu:timetable-custom:v2:${userId}`;
}

const validColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

export function loadCustomBackground(userId: string | number): CachedBackground | null {
  try {
    const value = wx.getStorageSync(key(userId)) as CachedBackground;
    return value && typeof value.version === "string" &&
      typeof value.filePath === "string" && value.filePath.length > 0 &&
      Number.isInteger(value.width) && value.width > 0 &&
      Number.isInteger(value.height) && value.height > 0 &&
      value.edges && (["top", "bottom", "left", "right"] as const)
        .every((edge) => validColor(value.edges[edge]))
      ? value : null;
  } catch { return null; }
}

export function saveCustomBackground(userId: string | number, value: CachedBackground): void {
  wx.setStorageSync(key(userId), value);
}

export function legacyCustomBackground(userId: string | number): { version: string; filePath: string } | null {
  try {
    const value = wx.getStorageSync(`easy-swu:timetable-custom:v1:${userId}`);
    return typeof value?.version === "string" && typeof value?.filePath === "string" ? value : null;
  } catch { return null; }
}

export function clearLegacyCustomBackground(userId: string | number): void {
  try { wx.removeStorageSync(`easy-swu:timetable-custom:v1:${userId}`); } catch { /* Keep the new cache. */ }
}

export function customFillIsVertical(background: CachedBackground | null): boolean {
  if (!background) return true;
  try {
    const { windowWidth, windowHeight } = wx.getWindowInfo();
    return background.width * windowHeight >= background.height * windowWidth;
  } catch { return true; }
}

export function readableBackgroundText(color: string): "#000000" | "#ffffff" {
  if (!validColor(color)) return "#000000";
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
  const luminance = channels
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > Math.sqrt(1.05 * 0.05) - 0.05 ? "#000000" : "#ffffff";
}

const COLOR_KEY = "easy-swu:timetable-course-color:v1";
export function loadCustomColor(): string {
  try {
    const value = wx.getStorageSync(COLOR_KEY);
    return CUSTOM_COLORS.find((color) => color === value) || DEFAULT_CUSTOM_COLOR;
  } catch { return DEFAULT_CUSTOM_COLOR; }
}
export function saveCustomColor(color: string): void {
  try { wx.setStorageSync(COLOR_KEY, color); } catch { /* Keep the choice for this visit. */ }
}

// Group nearby JPEG colors before voting, then average the winning bucket.
export function dominantEdgeColor(data: Uint8ClampedArray, width: number, height: number, edge: keyof TimetableEdgeColors): string {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  const sample = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    const r = data[offset], g = data[offset + 1], b = data[offset + 2];
    const bucket = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
    const tally = buckets.get(bucket) || { count: 0, r: 0, g: 0, b: 0 };
    tally.count++; tally.r += r; tally.g += g; tally.b += b;
    buckets.set(bucket, tally);
  };
  if (edge === "top" || edge === "bottom") {
    for (let x = 0; x < width; x++) sample(x, edge === "top" ? 0 : height - 1);
  } else {
    for (let y = 0; y < height; y++) sample(edge === "left" ? 0 : width - 1, y);
  }
  const winner = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  if (!winner) return "#ffffff";
  return ([winner.r, winner.g, winner.b] as number[])
    .map((value) => Math.round(value / winner.count).toString(16).padStart(2, "0"))
    .reduce((color, channel) => color + channel, "#");
}

export function imageEdgeColors(path: string): Promise<Pick<CachedBackground, "width" | "height" | "edges">> {
  return new Promise((resolve, reject) => {
    const loader = wx.createOffscreenCanvas({ type: "2d", width: 1, height: 1 });
    const image = loader.createImage();
    image.onload = () => {
      try {
        const width = image.width;
        const height = image.height;
        const horizontal = wx.createOffscreenCanvas({ type: "2d", width, height: 1 });
        const horizontalContext = horizontal.getContext("2d");
        horizontalContext.drawImage(image, 0, 0, width, 1, 0, 0, width, 1);
        const top = dominantEdgeColor(horizontalContext.getImageData(0, 0, width, 1).data, width, 1, "top");
        horizontalContext.drawImage(image, 0, height - 1, width, 1, 0, 0, width, 1);
        const bottom = dominantEdgeColor(horizontalContext.getImageData(0, 0, width, 1).data, width, 1, "top");
        const vertical = wx.createOffscreenCanvas({ type: "2d", width: 1, height });
        const verticalContext = vertical.getContext("2d");
        verticalContext.drawImage(image, 0, 0, 1, height, 0, 0, 1, height);
        const left = dominantEdgeColor(verticalContext.getImageData(0, 0, 1, height).data, 1, height, "left");
        verticalContext.drawImage(image, width - 1, 0, 1, height, 0, 0, 1, height);
        const right = dominantEdgeColor(verticalContext.getImageData(0, 0, 1, height).data, 1, height, "left");
        resolve({
          width,
          height,
          edges: { top, bottom, left, right },
        });
      } catch (error) { reject(error); }
    };
    image.onerror = reject;
    image.src = path;
  });
}
