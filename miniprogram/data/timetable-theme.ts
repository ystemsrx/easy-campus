export type TimetableThemeId =
  "default" | "companion" | "clawd" | "snack" | "vivid";

export type TimetableBackgroundMode = "scaleToFill" | "aspectFill";

export type TimetableCoursePalette = readonly [
  string,
  string,
  string,
  string,
  string,
];

export interface TimetableThemeOption {
  id: TimetableThemeId;
  label: string;
  backgroundColor: string;
  backgroundImage: string;
  backgroundMode: TimetableBackgroundMode;
  palette: TimetableCoursePalette | null;
}

export interface TimetableThemePatch {
  timetableThemeId: TimetableThemeId;
  backgroundImage: string;
  backgroundImageMode: TimetableBackgroundMode;
  backgroundColor: string;
  themeStyle: string;
  headerIconTone: "white" | "ink";
}

type RgbColor = readonly [number, number, number];
type HslColor = readonly [number, number, number];

export const TIMETABLE_THEME_STORAGE_KEY = "easy-swu:timetable-theme";
export const DEFAULT_TIMETABLE_COMPANION_COLOR = "#d97757";

const COURSE_TONE_IDS = ["blue", "cyan", "purple", "green", "orange"] as const;
const DEFAULT_BACKGROUND_IMAGE =
  "/assets/images/timetable-theme-default-background.webp";
const CLAWD_BACKGROUND_IMAGE =
  "/assets/images/timetable-theme-clawd-background.webp";
const DEFAULT_COURSE_PALETTE: TimetableCoursePalette = [
  "#0862ad",
  "#0862ad",
  "#0862ad",
  "#0862ad",
  "#0862ad",
];
const CLAWD_COURSE_PALETTE: TimetableCoursePalette = [
  "#8f432c",
  "#a45134",
  "#b85c38",
  "#c96d4c",
  "#d98261",
];
const SNACK_COURSE_PALETTE: TimetableCoursePalette = [
  "#dbf5ea",
  "#eadcf4",
  "#f2c5bd",
  "#f7f1e1",
  "#fde7d0",
];
const VIVID_COURSE_PALETTE: TimetableCoursePalette = [
  "#55b7ad",
  "#9b76c5",
  "#db7187",
  "#78c99a",
  "#e4b66f",
];

export const TIMETABLE_THEME_OPTIONS: readonly TimetableThemeOption[] = [
  {
    id: "default",
    label: "默认",
    backgroundColor: "#0862ad",
    backgroundImage: DEFAULT_BACKGROUND_IMAGE,
    backgroundMode: "scaleToFill",
    palette: DEFAULT_COURSE_PALETTE,
  },
  {
    id: "companion",
    label: "精灵",
    backgroundColor: "#f7f5ef",
    backgroundImage: "",
    backgroundMode: "aspectFill",
    palette: null,
  },
  {
    id: "clawd",
    label: "小克",
    backgroundColor: "#f8f7f2",
    backgroundImage: CLAWD_BACKGROUND_IMAGE,
    backgroundMode: "aspectFill",
    palette: CLAWD_COURSE_PALETTE,
  },
  {
    id: "snack",
    label: "点心",
    backgroundColor: "#fffdfa",
    backgroundImage: "",
    backgroundMode: "aspectFill",
    palette: SNACK_COURSE_PALETTE,
  },
  {
    id: "vivid",
    label: "饱和",
    backgroundColor: "#f3f2f6",
    backgroundImage: "",
    backgroundMode: "aspectFill",
    palette: VIVID_COURSE_PALETTE,
  },
];

function safeHexColor(value: string): string {
  return /^#[\da-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : DEFAULT_TIMETABLE_COMPANION_COLOR;
}

function rgbFromHex(value: string): RgbColor {
  const normalized = safeHexColor(value).slice(1);
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function channelHex(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, "0");
}

function rgbHex([red, green, blue]: RgbColor): string {
  return `#${channelHex(red)}${channelHex(green)}${channelHex(blue)}`;
}

function hslFromRgb([red, green, blue]: RgbColor): HslColor {
  const normalized = [red / 255, green / 255, blue / 255] as const;
  const maximum = Math.max(...normalized);
  const minimum = Math.min(...normalized);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  if (delta === 0) return [0, 0, lightness];

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (maximum === normalized[0]) {
    hue = 60 * (((normalized[1] - normalized[2]) / delta) % 6);
  } else if (maximum === normalized[1]) {
    hue = 60 * ((normalized[2] - normalized[0]) / delta + 2);
  } else {
    hue = 60 * ((normalized[0] - normalized[1]) / delta + 4);
  }
  return [hue < 0 ? hue + 360 : hue, saturation, lightness];
}

function rgbFromHsl([hue, saturation, lightness]: HslColor): RgbColor {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1));
  let channels: RgbColor;
  if (sector < 1) channels = [chroma, secondary, 0];
  else if (sector < 2) channels = [secondary, chroma, 0];
  else if (sector < 3) channels = [0, chroma, secondary];
  else if (sector < 4) channels = [0, secondary, chroma];
  else if (sector < 5) channels = [secondary, 0, chroma];
  else channels = [chroma, 0, secondary];

  const offset = lightness - chroma / 2;
  return channels.map(
    (channel) => (channel + offset) * 255,
  ) as unknown as RgbColor;
}

/**
 * Preserve the selected partner hue, cap saturation at 42%, then distribute
 * five fixed lightness steps so every course remains distinct but calm.
 */
export function companionCoursePalette(color: string): TimetableCoursePalette {
  const [sourceHue, sourceSaturation] = hslFromRgb(rgbFromHex(color));
  const saturation = Math.min(
    0.42,
    Math.max(sourceSaturation < 0.08 ? 0.06 : 0.18, sourceSaturation * 0.56),
  );
  const hue = sourceSaturation < 0.08 ? 30 : sourceHue;
  const lightnesses = [0.36, 0.4, 0.44, 0.48, 0.52] as const;
  return lightnesses.map((lightness) =>
    rgbHex(rgbFromHsl([hue, saturation, lightness])),
  ) as unknown as TimetableCoursePalette;
}

function colorWithAlpha(color: string, alpha: number): string {
  const [red, green, blue] = rgbFromHex(color);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function luminanceChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function relativeLuminance(color: string): number {
  const [red, green, blue] = rgbFromHex(color);
  return (
    luminanceChannel(red) * 0.2126 +
    luminanceChannel(green) * 0.7152 +
    luminanceChannel(blue) * 0.0722
  );
}

function contrastRatio(left: string, right: string): number {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

function readableCourseText(background: string): string {
  const lightText = "#ffffff";
  const darkText = "#28231f";
  return contrastRatio(background, lightText) >=
    contrastRatio(background, darkText)
    ? lightText
    : darkText;
}

function timetableThemeStyle(
  palette: TimetableCoursePalette,
  companionColor: string,
): string {
  const mutedCompanion = companionCoursePalette(companionColor);
  const declarations = [
    `--companion-color:${safeHexColor(companionColor)}`,
    `--companion-wash:${colorWithAlpha(mutedCompanion[4], 0.16)}`,
  ];
  COURSE_TONE_IDS.forEach((tone, index) => {
    declarations.push(`--timetable-course-${tone}:${palette[index]}`);
    declarations.push(
      `--timetable-course-${tone}-text:${readableCourseText(palette[index])}`,
    );
  });
  return `${declarations.join(";")};`;
}

export function resolveTimetableThemeId(value: unknown): TimetableThemeId {
  if (value === "image") return "default";
  const selected = TIMETABLE_THEME_OPTIONS.find((theme) => theme.id === value);
  return selected?.id || "default";
}

export function timetableThemePatch(
  id: unknown,
  companionColor: string,
): TimetableThemePatch {
  const selectedId = resolveTimetableThemeId(id);
  const selected =
    TIMETABLE_THEME_OPTIONS.find((theme) => theme.id === selectedId) ||
    TIMETABLE_THEME_OPTIONS[0];
  const palette =
    selected.id === "companion"
      ? companionCoursePalette(companionColor)
      : selected.palette || DEFAULT_COURSE_PALETTE;
  return {
    timetableThemeId: selected.id,
    backgroundImage: selected.backgroundImage,
    backgroundImageMode: selected.backgroundMode,
    backgroundColor: selected.backgroundColor,
    themeStyle: timetableThemeStyle(palette, companionColor),
    headerIconTone: selected.id === "default" ? "white" : "ink",
  };
}
