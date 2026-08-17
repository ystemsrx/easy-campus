export interface GridCourseTextInput {
  name: string;
  location: string;
  teacher: string;
}

export interface GridCourseTextMetrics {
  nameFontSizePx: number;
  locationFontSizePx: number;
  teacherFontSizePx: number;
  contentInsetPx: number;
  scale: number;
}

export interface GridCourseTextLayout {
  displayName: string;
  displayLocation: string;
  displayTeacher: string;
  nameLines: number;
  nameStyle: string;
  locationStyle: string;
  teacherStyle: string;
}

const NAME_CHARACTERS_PER_LINE = 3;
const LOCATION_CHARACTERS_PER_LINE = 4;
const TEACHER_CHARACTERS_PER_LINE = 3;
const MAX_NAME_LINES = 4;
const MIN_NAME_LINES = 2;
const MAX_LOCATION_LINES = 3;
const MAX_TEACHER_LINES = 2;
const NAME_LINE_HEIGHT = 1.12;
const META_LINE_HEIGHT = 1.08;
const META_MARGIN_RPX = 3;

export function truncateGridText(value: string, maxCharacters: number): string {
  const characters = Array.from(value.trim());
  return characters.length <= maxCharacters
    ? characters.join("")
    : `${characters.slice(0, maxCharacters - 1).join("")}…`;
}

function renderedLines(
  value: string,
  charactersPerLine: number,
  maximum: number,
): number {
  const length = Array.from(value).length;
  return length ? Math.min(maximum, Math.ceil(length / charactersPerLine)) : 0;
}

function textStyle(
  fontSizePx: number,
  lineHeightRatio: number,
  maximumLines: number,
): string {
  const lineHeightPx = fontSizePx * lineHeightRatio;
  return [
    `font-size:${fontSizePx.toFixed(2)}px`,
    `line-height:${lineHeightPx.toFixed(2)}px`,
    `max-height:${(lineHeightPx * maximumLines).toFixed(2)}px`,
  ].join(";");
}

/**
 * 课程名只在地点会被卡片底边裁掉时从四行依次收至三行、两行。
 * 教师允许自然延伸到卡片底边之外，因此不会反向挤压前两段文字。
 */
export function layoutGridCourseText(
  input: GridCourseTextInput,
  cardHeightPx: number,
  metrics: GridCourseTextMetrics,
): GridCourseTextLayout {
  const displayLocation = truncateGridText(
    input.location,
    LOCATION_CHARACTERS_PER_LINE * MAX_LOCATION_LINES,
  );
  const displayTeacher = truncateGridText(
    input.teacher,
    TEACHER_CHARACTERS_PER_LINE * MAX_TEACHER_LINES,
  );
  const rawNameLength = Array.from(input.name.trim()).length;
  const locationLines = renderedLines(
    displayLocation,
    LOCATION_CHARACTERS_PER_LINE,
    MAX_LOCATION_LINES,
  );
  const availableHeight = Math.max(0, cardHeightPx - metrics.contentInsetPx);
  const locationHeight =
    locationLines * metrics.locationFontSizePx * META_LINE_HEIGHT;
  const locationMargin = locationLines ? META_MARGIN_RPX * metrics.scale : 0;
  const locationFitsAfterName = (limit: number): boolean => {
    if (!locationLines) return true;
    const nameLines = Math.max(
      1,
      Math.min(limit, Math.ceil(rawNameLength / NAME_CHARACTERS_PER_LINE)),
    );
    const nameHeight = nameLines * metrics.nameFontSizePx * NAME_LINE_HEIGHT;
    return nameHeight + locationMargin + locationHeight <= availableHeight;
  };

  let nameLines = MAX_NAME_LINES;
  while (nameLines > MIN_NAME_LINES && !locationFitsAfterName(nameLines)) {
    nameLines -= 1;
  }

  return {
    displayName: truncateGridText(
      input.name,
      nameLines * NAME_CHARACTERS_PER_LINE,
    ),
    displayLocation,
    displayTeacher,
    nameLines,
    nameStyle: textStyle(metrics.nameFontSizePx, NAME_LINE_HEIGHT, nameLines),
    locationStyle: textStyle(
      metrics.locationFontSizePx,
      META_LINE_HEIGHT,
      MAX_LOCATION_LINES,
    ),
    teacherStyle: textStyle(
      metrics.teacherFontSizePx,
      META_LINE_HEIGHT,
      MAX_TEACHER_LINES,
    ),
  };
}
