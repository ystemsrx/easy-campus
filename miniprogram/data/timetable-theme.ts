export type TimetableThemeId =
  "default" | "companion" | "clawd" | "snack" | "vivid";

export type TimetableCoursePalette = readonly [
  string,
  string,
  string,
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
  palette: TimetableCoursePalette | null;
}

export interface TimetableThemePatch {
  timetableThemeId: TimetableThemeId;
  backgroundColor: string;
  companionBackgroundClass: "" | "timetable-companion-background--plain";
  themeStyle: string;
  headerIconTone: "white" | "ink";
}

type RgbColor = readonly [number, number, number];
type HslColor = readonly [number, number, number];

export const TIMETABLE_THEME_STORAGE_KEY = "easy-swu:timetable-theme";
export const DEFAULT_TIMETABLE_COMPANION_COLOR = "#111214";
const COMPANION_WARM_BACKGROUND = "#f7f5ef";

const COURSE_TONE_IDS = [
  "blue",
  "cyan",
  "purple",
  "green",
  "orange",
  "rose",
  "yellow",
  "mint",
] as const;
const DEFAULT_COURSE_PALETTE: TimetableCoursePalette = [
  "#0862ad",
  "#0862ad",
  "#0862ad",
  "#0862ad",
  "#0862ad",
  "#0862ad",
  "#0862ad",
  "#0862ad",
];
const CLAWD_COURSE_PALETTE: TimetableCoursePalette = [
  "#743722",
  "#88412a",
  "#9d4b30",
  "#b35738",
  "#d27a5c",
  "#dc8b6e",
  "#e6a088",
  "#efb7a3",
];
const SNACK_COURSE_PALETTE: TimetableCoursePalette = [
  "#dbf5ea",
  "#d1f0df",
  "#fde7d0",
  "#f8d0ba",
  "#f9f2d8",
  "#f2e4b9",
  "#f9c6c3",
  "#efbaa8",
];
const VIVID_COURSE_PALETTE: TimetableCoursePalette = [
  "#58aaa3",
  "#bd95e3",
  "#79c99c",
  "#75508f",
  "#b44c69",
  "#d2a04f",
  "#3e9fd0",
  "#e1846b",
];

export const TIMETABLE_THEME_OPTIONS: readonly TimetableThemeOption[] = [
  {
    id: "default",
    label: "默认",
    backgroundColor: "#0862ad",
    palette: DEFAULT_COURSE_PALETTE,
  },
  {
    id: "companion",
    label: "精灵",
    backgroundColor: COMPANION_WARM_BACKGROUND,
    palette: null,
  },
  {
    id: "clawd",
    label: "小克",
    backgroundColor: "#f8f7f2",
    palette: CLAWD_COURSE_PALETTE,
  },
  {
    id: "snack",
    label: "点心",
    backgroundColor: "#fffdfa",
    palette: SNACK_COURSE_PALETTE,
  },
  {
    id: "vivid",
    label: "饱和",
    backgroundColor: "#f3f2f6",
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Keep the selected partner color in the palette and build seven clear shades. */
export function companionCoursePalette(color: string): TimetableCoursePalette {
  const normalized = safeHexColor(color);
  const [sourceHue, sourceSaturation, sourceLightness] = hslFromRgb(
    rgbFromHex(normalized),
  );
  if (sourceSaturation < 0.12) {
    return [
      normalized,
      "#2e3033",
      "#44464a",
      "#5b5d61",
      "#74767a",
      "#8e9094",
      "#a9aaae",
      "#c4c5c8",
    ];
  }

  const saturation = clamp(sourceSaturation * 0.9, 0.62, 0.9);
  const shadeFactors = [0.42, 0.56, 0.7, 0.84] as const;
  const tintFactors = [0.14, 0.28, 0.42] as const;
  return [
    ...shadeFactors.map((factor) =>
      rgbHex(
        rgbFromHsl([
          sourceHue,
          saturation,
          clamp(sourceLightness * factor, 0.12, 0.68),
        ]),
      ),
    ),
    normalized,
    ...tintFactors.map((factor) =>
      rgbHex(
        rgbFromHsl([
          sourceHue,
          saturation,
          clamp(sourceLightness + (1 - sourceLightness) * factor, 0.3, 0.86),
        ]),
      ),
    ),
  ] as unknown as TimetableCoursePalette;
}

function colorWithAlpha(color: string, alpha: number): string {
  const [red, green, blue] = rgbFromHex(color);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function companionBackgroundColor(color: string): string {
  const [sourceHue, sourceSaturation] = hslFromRgb(
    rgbFromHex(safeHexColor(color)),
  );
  if (sourceSaturation < 0.12) return COMPANION_WARM_BACKGROUND;
  return rgbHex(
    rgbFromHsl([sourceHue, clamp(sourceSaturation * 0.48, 0.34, 0.5), 0.96]),
  );
}

function isNeutralCompanionColor(color: string): boolean {
  const [, sourceSaturation] = hslFromRgb(rgbFromHex(safeHexColor(color)));
  return sourceSaturation < 0.12;
}

function companionAmbientWash(color: string): string {
  const normalized = safeHexColor(color);
  const [, sourceSaturation] = hslFromRgb(rgbFromHex(normalized));
  return sourceSaturation < 0.12
    ? "transparent"
    : colorWithAlpha(normalized, 0.1);
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
  const blackText = "#000000";
  const whiteText = "#ffffff";
  return contrastRatio(background, whiteText) >=
    contrastRatio(background, blackText)
    ? whiteText
    : blackText;
}

function timetableThemeStyle(
  themeId: TimetableThemeId,
  palette: TimetableCoursePalette,
  companionColor: string,
  backgroundColor: string,
): string {
  const mutedCompanion = companionCoursePalette(companionColor);
  const declarations = [
    `--companion-color:${safeHexColor(companionColor)}`,
    `--companion-wash:${companionAmbientWash(mutedCompanion[4])}`,
  ];
  COURSE_TONE_IDS.forEach((tone, index) => {
    const courseFill =
      themeId === "companion" ? backgroundColor : palette[index];
    const courseBorder =
      themeId === "companion"
        ? palette[index]
        : "var(--timetable-course-border)";
    declarations.push(`--timetable-course-${tone}:${courseFill}`);
    declarations.push(`--timetable-course-${tone}-border:${courseBorder}`);
    declarations.push(
      `--timetable-course-${tone}-text:${readableCourseText(courseFill)}`,
    );
  });
  return `${declarations.join(";")};`;
}

export function resolveTimetableThemeId(value: unknown): TimetableThemeId {
  if (value === "image") return "default";
  const selected = TIMETABLE_THEME_OPTIONS.find((theme) => theme.id === value);
  return selected?.id || "default";
}

export function loadTimetableThemeId(): TimetableThemeId {
  try {
    return resolveTimetableThemeId(
      wx.getStorageSync(TIMETABLE_THEME_STORAGE_KEY),
    );
  } catch {
    return "default";
  }
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
  const backgroundColor =
    selected.id === "companion"
      ? companionBackgroundColor(companionColor)
      : selected.backgroundColor;
  return {
    timetableThemeId: selected.id,
    backgroundColor,
    companionBackgroundClass:
      selected.id === "companion" && isNeutralCompanionColor(companionColor)
        ? "timetable-companion-background--plain"
        : "",
    themeStyle: timetableThemeStyle(
      selected.id,
      palette,
      companionColor,
      backgroundColor,
    ),
    headerIconTone: selected.id === "default" ? "white" : "ink",
  };
}
