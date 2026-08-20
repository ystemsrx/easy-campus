const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const ts = require("typescript");

function loadTimetable() {
  const sourcePath = path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "data",
    "timetable.ts",
  );
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", "require", output)(
    moduleRecord,
    moduleRecord.exports,
    require,
  );
  return moduleRecord.exports;
}

function loadTimetableRender(timetableModule) {
  const sourcePath = path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "data",
    "timetable-render.ts",
  );
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", "require", output)(
    moduleRecord,
    moduleRecord.exports,
    (request) => {
      if (request === "./timetable") return timetableModule;
      return require(request);
    },
  );
  return moduleRecord.exports;
}

function loadMessageFormat() {
  const sourcePath = path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "utils",
    "format.ts",
  );
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  const weekdays = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  new Function("module", "exports", "require", output)(
    moduleRecord,
    moduleRecord.exports,
    (request) => {
      if (request === "./date") {
        return { formatMessageWeekday: (weekday) => weekdays[weekday] || "" };
      }
      return require(request);
    },
  );
  return moduleRecord.exports;
}

function loadSemesterFormat() {
  const sourcePath = path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "utils",
    "semester.ts",
  );
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", "require", output)(
    moduleRecord,
    moduleRecord.exports,
    require,
  );
  return moduleRecord.exports;
}

function loadCourseStatistics() {
  const sourcePath = path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "utils",
    "course-statistics.ts",
  );
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", output)(moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function loadTimetableTheme() {
  const sourcePath = path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "data",
    "timetable-theme.ts",
  );
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", output)(moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function colorSaturation(color) {
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255,
  );
  const maximum = Math.max(...channels);
  const minimum = Math.min(...channels);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  return delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
}

function colorLuminance(color) {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function colorContrast(left, right) {
  const leftLuminance = colorLuminance(left);
  const rightLuminance = colorLuminance(right);
  return (
    (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05)
  );
}

function themeStyleValue(style, property) {
  return style.match(new RegExp(`--${property}:([^;]+)`))?.[1] || "";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function decodeGifLzw(minimumCodeSize, bytes, expectedPixelCount) {
  const clearCode = 1 << minimumCodeSize;
  const endCode = clearCode + 1;
  let dictionary = [];
  let codeSize = minimumCodeSize + 1;
  let nextCode = endCode + 1;
  let bitOffset = 0;
  let previous = null;
  const pixels = [];

  const resetDictionary = () => {
    dictionary = Array.from({ length: endCode + 1 }, (_, code) =>
      code < clearCode ? [code] : [],
    );
    codeSize = minimumCodeSize + 1;
    nextCode = endCode + 1;
    previous = null;
  };
  const readCode = () => {
    let code = 0;
    for (let bit = 0; bit < codeSize; bit += 1) {
      const sourceBit = bitOffset + bit;
      const byte = bytes[sourceBit >> 3];
      if (byte === undefined) return null;
      code |= ((byte >> (sourceBit & 7)) & 1) << bit;
    }
    bitOffset += codeSize;
    return code;
  };

  resetDictionary();
  while (pixels.length < expectedPixelCount) {
    const code = readCode();
    if (code === null || code === endCode) break;
    if (code === clearCode) {
      resetDictionary();
      continue;
    }
    const entry =
      dictionary[code] && dictionary[code].length > 0
        ? dictionary[code]
        : code === nextCode && previous
          ? [...previous, previous[0]]
          : null;
    assert(entry, "GIF 首帧 LZW 数据必须可解码");
    pixels.push(...entry);
    if (previous && nextCode < 4096) {
      dictionary[nextCode] = [...previous, entry[0]];
      nextCode += 1;
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1;
    }
    previous = entry;
  }
  return pixels.slice(0, expectedPixelCount);
}

function gifMetadata(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert(bytes.toString("ascii", 0, 3) === "GIF", `${filePath} 必须是 GIF`);
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  const globalPacked = bytes[10];
  let offset = 13;
  if (globalPacked & 0x80) {
    offset += 3 * (1 << ((globalPacked & 0x07) + 1));
  }
  let pendingDelayMs = 0;
  let pendingTransparentIndex = null;
  let durationMs = 0;
  let frameCount = 0;
  let hasTransparency = false;
  let hasLoopExtension = false;
  let firstFrameBounds = null;
  const frameDelaysCs = [];
  const frameStartTimesMs = [];
  const graphicControlDelayOffsets = [];

  const readSubBlocks = () => {
    const chunks = [];
    while (offset < bytes.length) {
      const size = bytes[offset];
      offset += 1;
      if (size === 0) break;
      chunks.push(bytes.subarray(offset, offset + size));
      offset += size;
    }
    return Buffer.concat(chunks);
  };

  while (offset < bytes.length) {
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x3b) break;
    if (marker === 0x00) continue;
    if (marker === 0x21) {
      const label = bytes[offset];
      offset += 1;
      if (label === 0xf9) {
        const blockSize = bytes[offset];
        offset += 1;
        assert(blockSize === 4, "GIF 图形控制扩展长度必须合法");
        const packed = bytes[offset];
        const delayCs = bytes.readUInt16LE(offset + 1);
        pendingDelayMs = delayCs * 10;
        frameDelaysCs.push(delayCs);
        graphicControlDelayOffsets.push(offset + 1);
        pendingTransparentIndex = packed & 1 ? bytes[offset + 3] : null;
        hasTransparency ||= pendingTransparentIndex !== null;
        offset += blockSize;
        assert(bytes[offset] === 0, "GIF 图形控制扩展必须正确结束");
        offset += 1;
        continue;
      }
      if (label === 0xff) {
        const applicationBlockSize = bytes[offset];
        offset += 1;
        const applicationIdentifier = bytes.toString(
          "ascii",
          offset,
          offset + applicationBlockSize,
        );
        offset += applicationBlockSize;
        if (applicationIdentifier === "NETSCAPE2.0") {
          hasLoopExtension = true;
        }
        readSubBlocks();
        continue;
      }
      readSubBlocks();
      continue;
    }
    assert(marker === 0x2c, `GIF 块标记 0x${marker.toString(16)} 必须合法`);
    const left = bytes.readUInt16LE(offset);
    const top = bytes.readUInt16LE(offset + 2);
    const frameWidth = bytes.readUInt16LE(offset + 4);
    const frameHeight = bytes.readUInt16LE(offset + 6);
    const imagePacked = bytes[offset + 8];
    offset += 9;
    if (imagePacked & 0x80) {
      offset += 3 * (1 << ((imagePacked & 0x07) + 1));
    }
    const minimumCodeSize = bytes[offset];
    offset += 1;
    const imageData = readSubBlocks();
    frameCount += 1;
    frameStartTimesMs.push(durationMs);
    durationMs += pendingDelayMs;
    if (frameCount === 1) {
      const decoded = decodeGifLzw(
        minimumCodeSize,
        imageData,
        frameWidth * frameHeight,
      );
      const rows = [];
      if (imagePacked & 0x40) {
        for (const [start, step] of [
          [0, 8],
          [4, 8],
          [2, 4],
          [1, 2],
        ]) {
          for (let row = start; row < frameHeight; row += step) rows.push(row);
        }
      } else {
        for (let row = 0; row < frameHeight; row += 1) rows.push(row);
      }
      let minimumX = width;
      let minimumY = height;
      let maximumX = -1;
      let maximumY = -1;
      decoded.forEach((paletteIndex, index) => {
        if (paletteIndex === pendingTransparentIndex) return;
        const localX = index % frameWidth;
        const localY = rows[Math.floor(index / frameWidth)];
        minimumX = Math.min(minimumX, left + localX);
        minimumY = Math.min(minimumY, top + localY);
        maximumX = Math.max(maximumX, left + localX);
        maximumY = Math.max(maximumY, top + localY);
      });
      firstFrameBounds =
        maximumX < 0 ? null : [minimumX, minimumY, maximumX + 1, maximumY + 1];
    }
    pendingDelayMs = 0;
    pendingTransparentIndex = null;
  }
  return {
    width,
    height,
    durationMs,
    frameCount,
    hasTransparency,
    hasLoopExtension,
    firstFrameBounds,
    frameDelaysCs,
    frameStartTimesMs,
    graphicControlDelayOffsets,
  };
}

function gifCompositedRgbaFrames(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert(bytes.toString("ascii", 0, 3) === "GIF", `${filePath} 必须是 GIF`);
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  const globalPacked = bytes[10];
  const backgroundColorIndex = bytes[11];
  let offset = 13;
  const readColorTable = (entryCount) => {
    const colors = [];
    for (let index = 0; index < entryCount; index += 1) {
      colors.push([bytes[offset], bytes[offset + 1], bytes[offset + 2]]);
      offset += 3;
    }
    return colors;
  };
  const globalColorTable =
    globalPacked & 0x80
      ? readColorTable(1 << ((globalPacked & 0x07) + 1))
      : null;
  const readSubBlocks = () => {
    const chunks = [];
    while (offset < bytes.length) {
      const size = bytes[offset];
      offset += 1;
      if (size === 0) break;
      chunks.push(bytes.subarray(offset, offset + size));
      offset += size;
    }
    return Buffer.concat(chunks);
  };
  let canvas = Buffer.alloc(width * height * 4);
  let pendingTransparentIndex = null;
  let pendingDisposalMethod = 0;
  const frames = [];

  while (offset < bytes.length) {
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x3b) break;
    if (marker === 0x00) continue;
    if (marker === 0x21) {
      const label = bytes[offset];
      offset += 1;
      if (label === 0xf9) {
        const blockSize = bytes[offset];
        offset += 1;
        assert(blockSize === 4, "GIF 图形控制扩展长度必须合法");
        const packed = bytes[offset];
        pendingDisposalMethod = (packed >> 2) & 0x07;
        pendingTransparentIndex = packed & 1 ? bytes[offset + 3] : null;
        offset += blockSize;
        assert(bytes[offset] === 0, "GIF 图形控制扩展必须正确结束");
        offset += 1;
        continue;
      }
      readSubBlocks();
      continue;
    }

    assert(marker === 0x2c, `GIF 块标记 0x${marker.toString(16)} 必须合法`);
    const left = bytes.readUInt16LE(offset);
    const top = bytes.readUInt16LE(offset + 2);
    const frameWidth = bytes.readUInt16LE(offset + 4);
    const frameHeight = bytes.readUInt16LE(offset + 6);
    const imagePacked = bytes[offset + 8];
    offset += 9;
    const colorTable =
      imagePacked & 0x80
        ? readColorTable(1 << ((imagePacked & 0x07) + 1))
        : globalColorTable;
    assert(colorTable, "GIF 图像帧必须具有可用调色板");
    const minimumCodeSize = bytes[offset];
    offset += 1;
    const decoded = decodeGifLzw(
      minimumCodeSize,
      readSubBlocks(),
      frameWidth * frameHeight,
    );
    const rows = [];
    if (imagePacked & 0x40) {
      for (const [start, step] of [
        [0, 8],
        [4, 8],
        [2, 4],
        [1, 2],
      ]) {
        for (let row = start; row < frameHeight; row += step) rows.push(row);
      }
    } else {
      for (let row = 0; row < frameHeight; row += 1) rows.push(row);
    }
    const canvasBeforeFrame = Buffer.from(canvas);
    decoded.forEach((paletteIndex, index) => {
      if (paletteIndex === pendingTransparentIndex) return;
      const color = colorTable[paletteIndex];
      assert(color, "GIF 帧调色板索引必须有效");
      const x = left + (index % frameWidth);
      const y = top + rows[Math.floor(index / frameWidth)];
      if (x < 0 || x >= width || y < 0 || y >= height) return;
      const pixelOffset = (y * width + x) * 4;
      canvas[pixelOffset] = color[0];
      canvas[pixelOffset + 1] = color[1];
      canvas[pixelOffset + 2] = color[2];
      canvas[pixelOffset + 3] = 255;
    });
    frames.push(Buffer.from(canvas));

    if (pendingDisposalMethod === 2) {
      const backgroundColor = globalColorTable?.[backgroundColorIndex] || [
        0, 0, 0,
      ];
      const transparentBackground =
        pendingTransparentIndex !== null &&
        backgroundColorIndex === pendingTransparentIndex;
      for (let localY = 0; localY < frameHeight; localY += 1) {
        const y = top + localY;
        if (y < 0 || y >= height) continue;
        for (let localX = 0; localX < frameWidth; localX += 1) {
          const x = left + localX;
          if (x < 0 || x >= width) continue;
          const pixelOffset = (y * width + x) * 4;
          canvas[pixelOffset] = transparentBackground ? 0 : backgroundColor[0];
          canvas[pixelOffset + 1] = transparentBackground
            ? 0
            : backgroundColor[1];
          canvas[pixelOffset + 2] = transparentBackground
            ? 0
            : backgroundColor[2];
          canvas[pixelOffset + 3] = transparentBackground ? 0 : 255;
        }
      }
    } else if (pendingDisposalMethod === 3) {
      canvas = canvasBeforeFrame;
    }
    pendingTransparentIndex = null;
    pendingDisposalMethod = 0;
  }

  return { width, height, frames };
}

function cssBlock(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return "";
  const openBraceIndex = source.indexOf("{", markerIndex);
  if (openBraceIndex < 0) return "";
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(markerIndex, index + 1);
  }
  return "";
}

function escapeRegularExpression(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cssVariableTranslatePattern(name, fallback) {
  return `translateX\\(\\s*var\\(${escapeRegularExpression(name)},\\s*${escapeRegularExpression(fallback)}\\)\\s*\\)`;
}

function loadClawdScheduler(source, random) {
  const start = source.indexOf("type TimetableClawdSceneName");
  const end = source.indexOf("interface InFlightTimetableRequest");
  assert(start >= 0 && end > start, "必须能隔离加载小克动作袋调度逻辑");
  const isolatedSource = `${source.slice(start, end)}
module.exports = {
  CLAWD_ACTIONS,
  CLAWD_ACTION_BLOCK_SIZES,
  CLAWD_WEIGHTED_ARRIVALS,
  CLAWD_BRIDGE_COUNTS,
  CLAWD_WEIGHTED_BRIDGE_MODES,
  CLAWD_WEIGHTED_DEPARTURES,
  CLAWD_QUIET_RANGE_MS,
  CLAWD_SCENE_SOURCES,
  CLAWD_BASELINE_HANDOFF_MS,
  CLAWD_WALKING_SOURCE_DURATION_MS,
  CLAWD_WALKING_DURATION_MS,
  CLAWD_LURKING_DURATION_MS,
  CLAWD_WAVING_DURATION_MS,
  CLAWD_JUMPING_DURATION_MS,
  CLAWD_DANCING_DURATION_MS,
  CLAWD_LAPTOP_DURATION_MS,
  CLAWD_MAGNIFIER_DURATION_MS,
  CLAWD_RACING_DURATION_MS,
  CLAWD_ROWING_INTRO_DURATION_MS,
  CLAWD_ROWING_OUTRO_DURATION_MS,
  CLAWD_ROWING_DURATION_MS,
  CLAWD_STAGE_WIDTH_RPX,
  CLAWD_STAGE_HEIGHT_RPX,
  CLAWD_GRID_LEFT_RPX,
  CLAWD_GRID_WIDTH_RPX,
  CLAWD_GRID_HEAD_RPX,
  CLAWD_STOP_COLUMN_COUNT,
  CLAWD_STOP_ROW_COUNT,
  CLAWD_STOP_POOL_SIZE,
  CLAWD_STOP_X_RANGE_RPX,
  CLAWD_STOP_X_PHASE_RPX,
  CLAWD_STOP_CORE_BOUNDS,
  CLAWD_STOP_HALO_BOUNDS,
  CLAWD_STOP_HALO_WEIGHT,
  CLAWD_VEHICLE_ROUTE_RATIOS,
  createClawdJourneyPlanner,
  buildClawdJourney,
  clawdStopLayoutGeometry,
  clawdVisibleCourseRectangles,
  clawdRectangleIntersectionArea,
  clawdStopObstructionScore,
  clawdRouteOffsets,
  clawdStopPositionStyle,
  clawdStopCandidates,
  drawClawdStopPoint,
  drawClawdEntryEdge,
  randomIntegerInclusive,
};`;
  const output = ts.transpileModule(isolatedSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  const deterministicMath = Object.create(Math);
  deterministicMath.random = random;
  new Function("module", "exports", "Math", output)(
    moduleRecord,
    moduleRecord.exports,
    deterministicMath,
  );
  return moduleRecord.exports;
}

const timetable = loadTimetable();
const timetableRender = loadTimetableRender(timetable);
const messageFormat = loadMessageFormat();
const semesterFormat = loadSemesterFormat();
const courseStatistics = loadCourseStatistics();
const timetableTheme = loadTimetableTheme();

for (const courseName of [
  "高等数学",
  "  大学 英语（四） ",
  "Software Engineering 🚀",
  "新时代中国特色社会主义理论与实践课程设计综合训练一二三四五六七八九十",
]) {
  const normalized = courseName
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255)
    .toLocaleLowerCase("zh-CN");
  assert(
    courseStatistics.courseStatisticsKey(courseName) ===
      crypto.createHash("sha256").update(normalized).digest("hex"),
    "课表课程的通过率键必须与服务端课程名规范化和 SHA-256 规则一致",
  );
}

const summerSemester = {
  id: "2025-3",
  academicYear: 2025,
  academicYearLabel: "2025-2026",
  term: 3,
  label: "2025-2026 · 第三学期",
};
assert(
  semesterFormat.shortAcademicSemesterLabel(summerSemester) === "25-26 夏",
  "第三学期的课表短名称必须映射为夏",
);
assert(
  semesterFormat.shortAcademicSemesterLabel(summerSemester, " · ") ===
    "25-26 · 夏",
  "学期短名称必须支持课程选择器使用的点分隔符",
);
assert(
  semesterFormat.timetableSemesterMenuLabel(summerSemester) ===
    "2025-2026 · 夏",
  "课表菜单中的第三学期必须映射为夏",
);

assert(
  messageFormat.formatScheduleDate({
    weekStart: 4,
    weekEnd: 13,
    weeks: [4, 7, 10, 13],
    weekday: 1,
    periodStart: 7,
    periodEnd: 8,
    location: "09-0402",
  }) === "第4、7、10、13周 周一",
  "离散多周教务消息不得在前端重新压缩成连续周次",
);

const periodTimes = [
  [1, "08:00", "08:45"],
  [2, "08:55", "09:40"],
  [3, "10:00", "10:45"],
  [4, "10:55", "11:40"],
  [7, "14:00", "14:45"],
  [8, "14:55", "15:40"],
].map(([period, startTime, endTime]) => ({ period, startTime, endTime }));

function arrangement(id, start, end, startTime, endTime) {
  return {
    id,
    weekday: 1,
    weekdayLabel: "星期一",
    periodStart: start,
    periodEnd: end,
    periods: [start, end],
    startTime,
    endTime,
    weekText: "1-16周",
    weeks: Array.from({ length: 16 }, (_, index) => index + 1),
    activityType: "lecture",
    activityTypeLabel: "讲课",
    teacherNames: ["教师"],
    location: {
      campus: "北碚校区",
      building: "31教",
      room: `31教${id}`,
      display: `31教${id}`,
    },
    teachingMethod: null,
    selectionStatus: "selected",
    adjusted: false,
  };
}

function course(id, name, schedule) {
  return {
    id,
    courseCode: id,
    courseName: name,
    teachingClass: "教学班",
    teacherNames: ["教师"],
    credits: 2,
    category: null,
    nature: null,
    assessmentMethod: null,
    examMethod: null,
    teachingClassComposition: [],
    retake: false,
    selectionStatus: "selected",
    arrangements: [schedule],
  };
}

const semester = {
  id: "2026-1",
  academicYear: 2026,
  academicYearLabel: "2026-2027",
  term: 1,
  label: "2026-2027 · 第一学期",
};
const data = {
  semester,
  semesters: [semester],
  currentSemester: {
    ...semester,
    startDate: "2026-08-10",
    endDate: "2026-11-29",
  },
  semesterCalendar: {
    semesterId: semester.id,
    startDate: "2026-08-10",
    endDate: "2026-11-29",
    totalWeeks: 16,
    weeks: Array.from({ length: 16 }, (_, index) => {
      const start = new Date(2026, 7, 10 + index * 7);
      const end = new Date(2026, 7, 16 + index * 7);
      const dateKey = (value) =>
        `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
      return {
        weekNumber: index + 1,
        startDate: dateKey(start),
        endDate: dateKey(end),
      };
    }),
  },
  dataSource: "teaching_system",
  sourceTimeZone: "Asia/Shanghai",
  periods: periodTimes,
  courses: [
    course(
      "data-structure",
      "数据结构",
      arrangement("data-structure", 1, 2, "08:00", "09:40"),
    ),
    course(
      "college-english",
      "大学英语",
      arrangement("college-english", 3, 4, "10:00", "11:40"),
    ),
    course(
      "database",
      "数据库原理",
      arrangement("database", 7, 8, "14:00", "15:40"),
    ),
    course(
      "practice",
      "创新实践",
      arrangement("practice", 12, 13, "19:20", "21:00"),
    ),
  ],
  additionalCourses: [],
  summary: { courseCount: 4, arrangementCount: 4, maxWeek: 16 },
};

const sameCourseData = {
  ...data,
  courses: [
    {
      ...course(
        "same-course-a",
        "同一门课",
        arrangement("same-course-a", 1, 2, "08:00", "09:40"),
      ),
      courseCode: "SAME-101",
    },
    {
      ...course(
        "same-course-b",
        "同一门课",
        arrangement("same-course-b", 7, 8, "14:00", "15:40"),
      ),
      courseCode: "SAME-101",
    },
  ],
};
assert(
  new Set(
    timetable.coursesForWeek(sameCourseData, 1).map((item) => item.tone),
  ).size === 1,
  "同一课程代码的所有课表块必须稳定使用同一种颜色",
);

const overflowColorData = {
  ...data,
  courses: Array.from({ length: 9 }, (_, index) => {
    const period = index + 1;
    const hour = String(index + 8).padStart(2, "0");
    return course(
      `overflow-${period}`,
      `课程${period}`,
      arrangement(
        `overflow-${period}`,
        period,
        period,
        `${hour}:00`,
        `${hour}:45`,
      ),
    );
  }),
};
const overflowCourses = timetable
  .coursesForWeek(overflowColorData, 1)
  .sort((left, right) => left.periodStart - right.periodStart);
const tonePeriods = new Map();
overflowCourses.forEach((item) => {
  const periods = tonePeriods.get(item.tone) || [];
  periods.push(item.periodStart);
  tonePeriods.set(item.tone, periods);
});
const repeatedTonePeriods = [...tonePeriods.values()].filter(
  (periods) => periods.length > 1,
);
assert(
  tonePeriods.size === 8 &&
    repeatedTonePeriods.length === 1 &&
    repeatedTonePeriods[0][1] - repeatedTonePeriods[0][0] >= 7,
  "课程数超过色板数量时，重复颜色必须优先分配给距离较远的课程",
);

const duringFirstCourse = new Date(2026, 7, 10, 8, 30);
const currentAndNext = timetable.coursePreview(data, duringFirstCourse);
assert(currentAndNext.courses.length === 3, "进行中时应预览三节课");
assert(
  currentAndNext.currentCourseId === "data-structure:w1",
  "第一节进行中时应将它置于首位",
);
assert(
  currentAndNext.courses[1].id === "college-english:w1" &&
    currentAndNext.courses[2].id === "database:w1",
  "进行中课程后应紧跟当天后两节课",
);

const betweenCourses = new Date(2026, 7, 10, 9, 50);
const nextThree = timetable.coursePreview(data, betweenCourses);
assert(nextThree.courses.length === 3, "课间应预览接下来的三节课");
assert(nextThree.currentCourseId === null, "课间不应误标课程为进行中");
assert(
  nextThree.courses.every(
    (course) =>
      timetable.timeToMinutes(course.startTime) >
      timetable.currentMinutes(betweenCourses),
  ),
  "课间预览中只能出现尚未开始的课程",
);

const atCourseEnd = new Date(2026, 7, 10, 9, 40);
const afterFirstCourse = timetable.coursePreview(data, atCourseEnd);
assert(
  afterFirstCourse.currentCourseId === null &&
    afterFirstCourse.courses[0].id === "college-english:w1",
  "到达下课时刻后不应继续显示上一节为进行中",
);

const afterClasses = new Date(2026, 7, 10, 22, 0);
assert(
  timetable.coursePreview(data, afterClasses).courses.length === 0,
  "当天课程结束后不应保留预览课程",
);

assert(
  timetable.teachingWeekForDate(data, duringFirstCourse) === 1,
  "应根据学校返回的结构化周次计算教学周",
);
assert(
  timetable.timetableWeekForDisplay(data, new Date(2026, 7, 1)) === 1,
  "学期开始前应预加载下一学期第一周",
);
assert(
  timetable.timetableWeekForDisplay(data, new Date(2026, 11, 10)) === 16,
  "学期结束后应预加载上一学期最后一周",
);
const vacationSelection = {
  ...data,
  currentSemester: {
    ...semester,
    id: "2025-2",
    startDate: "2026-03-02",
    endDate: "2026-08-09",
  },
};
assert(
  timetable.weekDateKeys(vacationSelection, 1)[0] === "2026-08-10",
  "假期选中下学期时应使用该学期自己的结构化周次，而不是当前学期",
);
assert(
  timetable.coursePreview(null, duringFirstCourse).courses.length === 0,
  "没有真实课表时不得回退到占位课程",
);
const cachedWeekDates = timetable.buildTimetableWeekDateCache(data);
assert(
  cachedWeekDates.length === 16 &&
    cachedWeekDates[0].weekNumber === 1 &&
    cachedWeekDates[0].dates.length === 7 &&
    cachedWeekDates[0].dates[0] === "2026-08-10",
  "本地课表快照必须包含全部周次及每周日期",
);
assert(
  timetableRender.buildTimetableWeekPlaceholder(data, 1, []).startDateLabel ===
    "8/10",
  "空的旧周次日期缓存不得覆盖可由当前校历重新计算出的日期",
);
const alignedGridMetrics = timetableRender.timetableGridLayoutMetrics(13, 64);
const alignedWeekPage = timetableRender.buildTimetableWeekPage(
  data,
  1,
  13,
  alignedGridMetrics,
);
const alignedCourse = alignedWeekPage.gridDays
  .flatMap((day) => day.courses)
  .find(Boolean);
const finalPeriodCourse = alignedWeekPage.gridDays
  .flatMap((day) => day.courses)
  .find((course) => course.periodEnd === 13);
const alignedPeriodLabelTopPx =
  (alignedGridMetrics.rowHeightPx - 67 * alignedGridMetrics.scale) / 2;
assert(
  alignedCourse &&
    Number(alignedCourse.topInsetPx) > 2 * alignedGridMetrics.scale &&
    Number(alignedCourse.heightPercent) >
      ((alignedCourse.periodEnd - alignedCourse.periodStart + 1) / 13) * 100 &&
    Math.abs(
      alignedPeriodLabelTopPx -
        alignedGridMetrics.courseTopInsetPx -
        3 * alignedGridMetrics.scale,
    ) < 0.001 &&
    Math.abs(
      alignedGridMetrics.courseHeightExtensionPx -
        (alignedGridMetrics.courseTopInsetPx - alignedGridMetrics.scale),
    ) < 0.001 &&
    Math.abs(
      alignedGridMetrics.contentInsetPx - 17 * alignedGridMetrics.scale,
    ) < 0.001 &&
    finalPeriodCourse &&
    Number(finalPeriodCourse.topPercent) +
      Number(finalPeriodCourse.heightPercent) <=
      100,
  "课程块顶部必须略高于节次数字，并保留约 3rpx 的相邻课程间距",
);

const textMetrics = {
  nameFontSizePx: 10,
  locationFontSizePx: 8,
  teacherFontSizePx: 8,
  contentWidthPx: 33,
  contentInsetPx: 4,
  scale: 0.5,
};
const longText = {
  name: "一二三四五六七八九十甲乙丙",
  location: "一二三四五六七八九十甲乙丙",
  teacher: "一二三四五六七",
};
const roomyLayout = timetable.layoutGridCourseText(longText, 80, textMetrics);
assert(roomyLayout.nameLines === 4, "高度充足时课程名应保留四行");
assert(
  JSON.stringify(roomyLayout.nameRows.map((row) => row.text)) ===
    JSON.stringify(["一二三", "四五六", "七八九", "十甲…"]),
  "课程名应严格每行三字，并在第四行第三个位置显示省略号",
);
assert(
  JSON.stringify(roomyLayout.locationRows.map((row) => row.text)) ===
    JSON.stringify(["@一二三", "四五六七", "八九十…"]),
  "地点应带 @ 前缀并严格每行四个字符、最多三行",
);
assert(
  JSON.stringify(roomyLayout.teacherRows.map((row) => row.text)) ===
    JSON.stringify(["一二三", "四五…"]),
  "教师应严格每行三字、最多两行",
);
assert(
  timetable
    .layoutGridCourseText(
      { ...longText, location: "@31教0503" },
      80,
      textMetrics,
    )
    .locationRows.map((row) => row.text)
    .join("") === "@31教0503",
  "已有 @ 前缀的地点不得重复添加前缀",
);
const compactAddressLayout = timetable.layoutGridCourseText(
  { ...longText, location: "31教0503" },
  90,
  {
    ...textMetrics,
    locationFontSizePx: 14,
    contentWidthPx: 40,
  },
);
const compactAddressFontSize = Number(
  compactAddressLayout.locationStyle.match(/font-size:([\d.]+)px/)?.[1],
);
assert(
  compactAddressFontSize > (40 - 1) / 4,
  "半角字符较多的地点应使用比四个全角字更大的字号",
);
const fullWidthAddressLayout = timetable.layoutGridCourseText(
  { ...longText, location: "天地玄黄宇宙洪荒" },
  90,
  {
    ...textMetrics,
    locationFontSizePx: 14,
    contentWidthPx: 40,
  },
);
const fullWidthAddressFontSize = Number(
  fullWidthAddressLayout.locationStyle.match(/font-size:([\d.]+)px/)?.[1],
);
assert(
  fullWidthAddressFontSize <= (40 - 1) / 4,
  "包含四个全角字的地点仍应完整落在课程卡片内",
);
assert(
  timetable.layoutGridCourseText(longText, 66, textMetrics).nameLines === 3,
  "只有地点将越过底边时才应把课程名降为三行",
);
assert(
  timetable.layoutGridCourseText(longText, 58, textMetrics).nameLines === 2,
  "地点仍会越界时应继续把课程名降为两行",
);
assert(
  timetable.layoutGridCourseText({ ...longText, location: "" }, 20, textMetrics)
    .nameLines === 4,
  "教师越界或没有地点时不得压缩课程名",
);

const timetablePageRoot = path.resolve(
  __dirname,
  "..",
  "miniprogram",
  "pages",
  "timetable",
);
const timetablePageScript = fs.readFileSync(
  path.join(timetablePageRoot, "index.ts"),
  "utf8",
);
const timetablePageTemplate = fs.readFileSync(
  path.join(timetablePageRoot, "index.wxml"),
  "utf8",
);
const timetablePageStyles = fs.readFileSync(
  path.join(timetablePageRoot, "index.wxss"),
  "utf8",
);
const timetableThemeSource = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "data", "timetable-theme.ts"),
  "utf8",
);
const geometricPetSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "components",
    "geometric-pet",
    "geometric-pet.ts",
  ),
  "utf8",
);
const timetableImageRoot = path.resolve(
  __dirname,
  "..",
  "miniprogram",
  "assets",
  "images",
);
const timetableLoginAssetRoot = path.resolve(
  __dirname,
  "..",
  "miniprogram",
  "assets",
  "login",
);
const clawdKeyframeStart = timetablePageStyles.indexOf(
  "@keyframes clawd-lurk-from-left",
);
const clawdKeyframeEnd = timetablePageStyles.indexOf(
  "@keyframes companion-wander",
);
const clawdKeyframes = timetablePageStyles.slice(
  clawdKeyframeStart,
  clawdKeyframeEnd,
);
const timetableStoreSource = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "store", "timetable.ts"),
  "utf8",
);
const timetableRenderSource = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "data", "timetable-render.ts"),
  "utf8",
);
const appSource = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "app.ts"),
  "utf8",
);
const passRatePageTemplate = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "pages",
    "pass-rates",
    "index.wxml",
  ),
  "utf8",
);
const passRateCardTemplate = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "components",
    "pass-rate-card",
    "pass-rate-card.wxml",
  ),
  "utf8",
);
const bottomSheetScript = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "components",
    "bottom-sheet",
    "bottom-sheet.ts",
  ),
  "utf8",
);
const bottomSheetTemplate = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "miniprogram",
    "components",
    "bottom-sheet",
    "bottom-sheet.wxml",
  ),
  "utf8",
);
const dayColumnRule = timetablePageStyles.match(
  /\.grid-day-column\s*\{[^}]*\}/s,
)?.[0];
const periodLineRule = timetablePageStyles.match(
  /\.period-grid-line\s*\{[^}]*\}/s,
)?.[0];
const timetableThemeAssets = [
  "timetable-theme-default-background.jpg",
  "timetable-theme-clawd-background.jpg",
  "timetable-theme-clawd-walking.gif",
  "timetable-theme-clawd-lurking.gif",
  "timetable-theme-clawd-waving.gif",
  "timetable-theme-clawd-jumping.gif",
  "timetable-theme-clawd-dancing.gif",
  "timetable-theme-clawd-racing-car.gif",
  "timetable-theme-clawd-rowing-intro.gif",
  "timetable-theme-clawd-rowing-outro.gif",
  "timetable-theme-clawd-rowing.gif",
  "timetable-theme-clawd-idle.svg",
];
const timetableLegacyBackgroundAssets = [
  "timetable-theme-default-background.webp",
  "timetable-theme-clawd-background.webp",
  "timetable-theme-default-background.png",
  "timetable-theme-clawd-background.png",
  "timetable-background.png",
];
const defaultThemePatch = timetableTheme.timetableThemePatch(
  "default",
  "#ff3e51",
);
const companionColors = ["#ff3e51", "#00b96b", "#2a92fe", "#9159fe"];
const companionPalettes = companionColors.map((color) =>
  timetableTheme.companionCoursePalette(color),
);
const blackCompanionPalette = timetableTheme.companionCoursePalette("#111214");
const blackCompanionTheme = timetableTheme.timetableThemePatch(
  "companion",
  "#111214",
);
const redCompanionTheme = timetableTheme.timetableThemePatch(
  "companion",
  "#ff3e51",
);
const accessibilityColorChannels = [0, 51, 102, 153, 204, 255];
const accessibilityCompanionColors = [
  "#111214",
  "#d97757",
  ...companionColors,
  ...accessibilityColorChannels.flatMap((red) =>
    accessibilityColorChannels.flatMap((green) =>
      accessibilityColorChannels.map(
        (blue) =>
          `#${[red, green, blue]
            .map((channel) => channel.toString(16).padStart(2, "0"))
            .join("")}`,
      ),
    ),
  ),
];
const accessibilityThemePatches = [
  defaultThemePatch,
  timetableTheme.timetableThemePatch("clawd", "#ff3e51"),
  timetableTheme.timetableThemePatch("snack", "#ff3e51"),
  timetableTheme.timetableThemePatch("vivid", "#ff3e51"),
  ...accessibilityCompanionColors.map((color) =>
    timetableTheme.timetableThemePatch("companion", color),
  ),
];
const timetableCourseTones = [
  "blue",
  "cyan",
  "purple",
  "green",
  "orange",
  "rose",
  "yellow",
  "mint",
];
const expectedThemePalettes = {
  clawd: [
    "#743722",
    "#88412a",
    "#9d4b30",
    "#b35738",
    "#d27a5c",
    "#dc8b6e",
    "#e6a088",
    "#efb7a3",
  ],
  snack: [
    "#dbf5ea",
    "#d1f0df",
    "#fde7d0",
    "#f8d0ba",
    "#f9f2d8",
    "#f2e4b9",
    "#f9c6c3",
    "#efbaa8",
  ],
  vivid: [
    "#58aaa3",
    "#bd95e3",
    "#79c99c",
    "#75508f",
    "#b44c69",
    "#d2a04f",
    "#3e9fd0",
    "#e1846b",
  ],
};
assert(
  timetableTheme.TIMETABLE_THEME_OPTIONS.map(({ label }) => label).join(",") ===
    "默认,精灵,小克,点心,饱和" &&
    timetablePageTemplate.includes(
      '<text class="theme-option-label">{{item.label}}</text>',
    ),
  "课表主题菜单必须显示五个主题名称",
);
assert(
  timetableThemeAssets.every((asset) =>
    fs.existsSync(path.join(timetableImageRoot, asset)),
  ) &&
    [
      "timetable-theme-default-background.jpg",
      "timetable-theme-clawd-background.jpg",
    ].every((asset) =>
      fs
        .readFileSync(path.join(timetableImageRoot, asset))
        .subarray(0, 3)
        .equals(Buffer.from("ffd8ff", "hex")),
    ) &&
    timetableLegacyBackgroundAssets.every(
      (asset) => !fs.existsSync(path.join(timetableImageRoot, asset)),
    ) &&
    !fs.existsSync(
      path.resolve(__dirname, "..", "assets", "source", "timetable"),
    ) &&
    timetablePageTemplate.includes(
      'src="/assets/images/timetable-theme-default-background.jpg"',
    ) &&
    timetablePageTemplate.includes(
      'src="/assets/images/timetable-theme-clawd-background.jpg"',
    ) &&
    !timetablePageTemplate.includes('webp="{{true}}"') &&
    timetablePageScript.includes(
      "/assets/images/timetable-theme-clawd-walking.gif",
    ) &&
    timetablePageScript.includes("/assets/login/lurking.gif") &&
    timetablePageScript.includes("/assets/login/waving.gif") &&
    timetablePageScript.includes(
      "/assets/images/timetable-theme-clawd-jumping.gif",
    ) &&
    timetablePageScript.includes("/assets/login/dancing.gif") &&
    !timetablePageTemplate.includes("background.png") &&
    !timetablePageTemplate.includes("background.webp"),
  "课表壁纸必须仅保留规范命名的本地 JPG 素材",
);
assert(
  timetableTheme.resolveTimetableThemeId("image") === "default" &&
    timetableTheme.resolveTimetableThemeId("unknown") === "default" &&
    timetableCourseTones.every((tone) =>
      defaultThemePatch.themeStyle.includes(
        `--timetable-course-${tone}:#0862ad`,
      ),
    ) &&
    timetablePageTemplate.includes("timetableThemeId === 'default'") &&
    timetablePageTemplate.includes('style="{{imageStyle}}"'),
  "默认主题必须迁移旧偏好并保留原壁纸与蓝色课程块",
);
assert(
  companionPalettes.every(
    (palette, index) =>
      new Set(palette).size === 8 &&
      palette[4] === companionColors[index] &&
      palette.every((color) => colorSaturation(color) >= 0.6),
  ) &&
    blackCompanionPalette.length === 8 &&
    blackCompanionPalette[0] === "#111214" &&
    blackCompanionPalette.every((color) => colorSaturation(color) <= 0.1) &&
    timetableTheme.DEFAULT_TIMETABLE_COMPANION_COLOR === "#111214" &&
    timetableThemeSource.includes("sourceSaturation * 0.9") &&
    timetablePageScript.includes("loadPetPreferences(account)") &&
    redCompanionTheme.themeStyle.includes("--companion-color:#ff3e51") &&
    timetablePageStyles.includes(".theme-swatch--companion") &&
    timetablePageTemplate.includes(
      'style="background-color: {{companionColor}};"',
    ),
  "精灵主题必须保留伙伴原色，并生成清晰的同色系八档梯度",
);
assert(
  new Set(
    companionColors.map((color) => {
      const patch = timetableTheme.timetableThemePatch("companion", color);
      return themeStyleValue(patch.themeStyle, "timetable-course-blue");
    }),
  ).size === companionColors.length &&
    [...companionColors, "#111214"].every((color) => {
      const patch = timetableTheme.timetableThemePatch("companion", color);
      const borderPalette = timetableTheme.companionCoursePalette(color);
      return timetableCourseTones.every(
        (tone, index) =>
          themeStyleValue(patch.themeStyle, `timetable-course-${tone}`) ===
            patch.backgroundColor &&
          themeStyleValue(
            patch.themeStyle,
            `timetable-course-${tone}-border`,
          ) === borderPalette[index] &&
          timetablePageStyles.includes(
            `border-color: var(--timetable-course-${tone}-border)`,
          ),
      );
    }) &&
    ["default", "clawd", "snack", "vivid"].every((themeId) => {
      const patch = timetableTheme.timetableThemePatch(themeId, "#ff3e51");
      return timetableCourseTones.every(
        (tone) =>
          themeStyleValue(
            patch.themeStyle,
            `timetable-course-${tone}-border`,
          ) === "var(--timetable-course-border)",
      );
    }),
  "精灵主题课程块必须动态跟随页面底色，仅由伙伴同色系边线承载课程配色",
);
assert(
  blackCompanionTheme.backgroundColor === "#f7f5ef" &&
    blackCompanionTheme.companionBackgroundClass ===
      "timetable-companion-background--plain" &&
    blackCompanionTheme.themeStyle.includes("--companion-wash:transparent") &&
    redCompanionTheme.companionBackgroundClass === "" &&
    redCompanionTheme.backgroundColor !== "#f7f5ef" &&
    colorLuminance(redCompanionTheme.backgroundColor) >= 0.85 &&
    timetablePageTemplate.includes("{{companionBackgroundClass}}") &&
    /\.timetable-theme--companion\.timetable-companion-background--plain\s+\.background-shade\s*\{[^}]*background:\s*none;/s.test(
      timetablePageStyles,
    ) &&
    timetablePageStyles.includes("rgba(255, 255, 255, 0.16)") &&
    timetablePageStyles.includes("rgba(255, 235, 209, 0.08)") &&
    !timetablePageStyles.includes("rgba(232, 222, 208, 0.16)"),
  "黑色精灵主题必须使用与其他页面一致的纯暖色背景，不得叠加渐变",
);
assert(
  timetablePageScript.includes(
    "const petEnabled = Boolean(account) && shouldShowPet(pet);",
  ) &&
    timetablePageScript.includes(
      "const timetablePet = petEnabled ? pet : DEFAULT_PET_PREFERENCES;",
    ) &&
    timetablePageScript.includes("petShape: timetablePet.shape") &&
    timetablePageScript.includes("petColor: companionColor") &&
    timetablePageScript.includes("petVisible: true") &&
    !timetablePageScript.includes("savePetPreferences") &&
    timetablePageTemplate.includes(
      "timetableThemeId === 'companion' && petVisible",
    ),
  "未启用伙伴时只能在精灵主题内显示默认黑色伙伴，不能改写全局偏好",
);
assert(
  Object.entries(expectedThemePalettes).every(([themeId, colors]) => {
    const { themeStyle } = timetableTheme.timetableThemePatch(
      themeId,
      "#ff3e51",
    );
    return colors.every((color) => themeStyle.includes(color));
  }),
  "小克、点心与饱和主题必须保留各自的参考色板",
);
assert(
  accessibilityThemePatches.every(({ themeStyle }) =>
    timetableCourseTones.every((tone) => {
      const textColor = themeStyleValue(
        themeStyle,
        `timetable-course-${tone}-text`,
      );
      return (
        ["#000000", "#ffffff"].includes(textColor) &&
        colorContrast(
          themeStyleValue(themeStyle, `timetable-course-${tone}`),
          textColor,
        ) >= 4.5
      );
    }),
  ),
  "所有主题课程文字只能使用纯黑或纯白，并与色块保持至少 4.5:1 的对比度",
);
assert(
  !timetableThemeSource.includes('darkText = "#0d0e10"') &&
    !/\.grid-course-room,\s*\.grid-course-teacher\s*\{[^}]*opacity:/s.test(
      timetablePageStyles,
    ) &&
    !/\.grid-course-teacher\s*\{[^}]*opacity:/s.test(timetablePageStyles) &&
    !/\.grid-course--pressed\s*\{[^}]*opacity:/s.test(timetablePageStyles),
  "课程文字与按压态不得通过透明度混色为灰色",
);
assert(
  ["clawd", "vivid"].every((themeId) => {
    const { themeStyle } = timetableTheme.timetableThemePatch(
      themeId,
      "#ff3e51",
    );
    return timetableCourseTones.every((tone) => {
      const textColor = themeStyleValue(
        themeStyle,
        `timetable-course-${tone}-text`,
      );
      return (
        textColor !== "#000000" ||
        colorContrast(
          themeStyleValue(themeStyle, `timetable-course-${tone}`),
          textColor,
        ) >= 6
      );
    });
  }),
  "小克与饱和主题使用深色文字时必须保持至少 6:1 的清晰对比度",
);
assert(
  timetablePageTemplate.includes('id="timetable-companion"') &&
    timetablePageTemplate.includes('auto-cycle="{{true}}"') &&
    timetablePageTemplate.includes('cycle-interval="{{2900}}"') &&
    timetablePageTemplate.includes('bindtouchmove="updateCompanionGaze"') &&
    timetablePageTemplate.includes('bindtap="onTimetableInteraction"') &&
    geometricPetSource.includes(
      "setExternalGazeTarget(x: number, y: number)",
    ) &&
    geometricPetSource.includes("playInteraction()") &&
    /\.clawd-ambient-layer,\s*\.timetable-companion-layer\s*\{[^}]*z-index:\s*1[^}]*pointer-events:\s*none/s.test(
      timetablePageStyles,
    ),
  "背景角色必须响应课表手势，同时保持在课程层下方且不吞掉操作",
);
assert(
  timetablePageTemplate.includes("motionClass !== 'motion-reduced'") &&
    timetablePageTemplate.includes("timetable-theme-clawd-idle.svg") &&
    (timetablePageTemplate.match(/src="\{\{clawdSceneSrc\}\}"/g) || [])
      .length === 1 &&
    timetablePageTemplate.includes(
      'class="clawd-scene-stage {{clawdSceneMotionClass}}"',
    ) &&
    timetablePageTemplate.includes('style="{{clawdScenePositionStyle}}"') &&
    timetablePageTemplate.includes(
      'class="clawd-scene-media {{clawdSceneMediaClass}}"',
    ) &&
    timetablePageScript.includes("petReducedMotion") &&
    timetablePageScript.includes("clawdSceneMediaClass") &&
    timetablePageScript.includes("playClawdSceneStep(revision: number)"),
  "小克背景必须只渲染一个动图，并在减少动态效果时退回静态角色",
);
assert(
  timetablePageScript.includes("CLAWD_BASELINE_HANDOFF_MS = 80") &&
    timetablePageScript.includes("CLAWD_WALKING_SOURCE_DURATION_MS = 1860") &&
    timetablePageScript.includes("CLAWD_LURKING_SOURCE_DURATION_MS = 5580") &&
    timetablePageScript.includes("CLAWD_WAVING_SOURCE_DURATION_MS = 1410") &&
    timetablePageScript.includes("CLAWD_JUMPING_SOURCE_DURATION_MS = 1760") &&
    timetablePageScript.includes("CLAWD_DANCING_SOURCE_DURATION_MS = 3330") &&
    timetablePageScript.includes("CLAWD_LAPTOP_SOURCE_DURATION_MS = 3580") &&
    timetablePageScript.includes("CLAWD_MAGNIFIER_SOURCE_DURATION_MS = 9410") &&
    timetablePageScript.includes("CLAWD_RACING_SOURCE_DURATION_MS = 4010") &&
    timetablePageScript.includes(
      "CLAWD_ROWING_INTRO_SOURCE_DURATION_MS = 2170",
    ) &&
    timetablePageScript.includes(
      "CLAWD_ROWING_OUTRO_SOURCE_DURATION_MS = 2170",
    ) &&
    timetablePageScript.includes("CLAWD_ROWING_SOURCE_DURATION_MS = 1760") &&
    timetablePageScript.includes(
      'walking: "/assets/images/timetable-theme-clawd-walking.gif"',
    ) &&
    timetablePageScript.includes('lurking: "/assets/login/lurking.gif"') &&
    timetablePageScript.includes('waving: "/assets/login/waving.gif"') &&
    timetablePageScript.includes('dancing: "/assets/login/dancing.gif"') &&
    timetablePageScript.includes('laptop: "/assets/login/laptop.gif"') &&
    timetablePageScript.includes('magnifier: "/assets/login/magnifier.gif"') &&
    timetablePageScript.includes(
      'jumping: "/assets/images/timetable-theme-clawd-jumping.gif"',
    ) &&
    timetablePageScript.includes(
      'racing: "/assets/images/timetable-theme-clawd-racing-car.gif"',
    ) &&
    timetablePageScript.includes(
      '"rowing-intro": "/assets/images/timetable-theme-clawd-rowing-intro.gif"',
    ) &&
    timetablePageScript.includes(
      '"rowing-outro": "/assets/images/timetable-theme-clawd-rowing-outro.gif"',
    ) &&
    timetablePageScript.includes(
      'rowing: "/assets/images/timetable-theme-clawd-rowing.gif"',
    ),
  "小克动作必须使用统一画布素材及包含基准帧交接的精确时长",
);
const clawdAssetExpectations = [
  [timetableLoginAssetRoot, "crabwalking.gif", 275, 185, 1660],
  [timetableImageRoot, "timetable-theme-clawd-walking.gif", 275, 185, 1860],
  [timetableLoginAssetRoot, "lurking.gif", 275, 185, 5580],
  [timetableLoginAssetRoot, "waving.gif", 275, 185, 1410],
  [timetableLoginAssetRoot, "dancing.gif", 275, 185, 3330],
  [timetableLoginAssetRoot, "laptop.gif", 275, 185, 3580],
  [timetableLoginAssetRoot, "magnifier.gif", 275, 185, 9410],
  [timetableImageRoot, "timetable-theme-clawd-jumping.gif", 150, 101, 1760],
  [timetableImageRoot, "timetable-theme-clawd-racing-car.gif", 275, 185, 4010],
  [
    timetableImageRoot,
    "timetable-theme-clawd-rowing-intro.gif",
    275,
    185,
    2170,
  ],
  [
    timetableImageRoot,
    "timetable-theme-clawd-rowing-outro.gif",
    275,
    185,
    2170,
  ],
  [timetableImageRoot, "timetable-theme-clawd-rowing.gif", 275, 185, 1760],
];
const clawdAssetMetadata = new Map(
  clawdAssetExpectations.map(([root, filename, width, height, durationMs]) => {
    const metadata = gifMetadata(path.join(root, filename));
    assert(
      metadata.width === width &&
        metadata.height === height &&
        metadata.durationMs === durationMs &&
        metadata.frameCount > 0 &&
        metadata.hasTransparency,
      `${filename} 必须保留 ${width}×${height}、${durationMs}ms 与透明帧`,
    );
    return [filename, metadata];
  }),
);
{
  const sourcePath = path.join(timetableLoginAssetRoot, "crabwalking.gif");
  const targetPath = path.join(
    timetableImageRoot,
    "timetable-theme-clawd-walking.gif",
  );
  const sourceBytes = fs.readFileSync(sourcePath);
  const targetBytes = fs.readFileSync(targetPath);
  const sourceMetadata = clawdAssetMetadata.get("crabwalking.gif");
  const targetMetadata = clawdAssetMetadata.get(
    "timetable-theme-clawd-walking.gif",
  );
  const expectedSourceDelays = [
    8, 9, 8, 8, 9, 8, 8, 9, 8, 8, 9, 8, 8, 9, 8, 8, 9, 8, 8, 8,
  ];
  const expectedTargetDelays = expectedSourceDelays.map((delay) => delay + 1);
  const expectedTargetBytes = Buffer.from(sourceBytes);
  sourceMetadata.graphicControlDelayOffsets.forEach((offset, index) => {
    expectedTargetBytes.writeUInt16LE(expectedTargetDelays[index], offset);
  });
  assert(
    sourceMetadata.frameCount === 20 &&
      sourceMetadata.frameDelaysCs.join(",") ===
        expectedSourceDelays.join(",") &&
      targetMetadata.frameCount === 20 &&
      targetMetadata.frameDelaysCs.join(",") ===
        expectedTargetDelays.join(",") &&
      targetMetadata.hasLoopExtension === true &&
      targetMetadata.firstFrameBounds.join(",") ===
        sourceMetadata.firstFrameBounds.join(",") &&
      targetBytes.equals(expectedTargetBytes),
    "标准 Walking GIF 必须只修改 20 个 GCE delay word 并精确延长到 1860ms",
  );
}
assert(
  clawdAssetMetadata.get("timetable-theme-clawd-rowing-intro.gif")
    .hasLoopExtension === false &&
    clawdAssetMetadata
      .get("timetable-theme-clawd-rowing-intro.gif")
      .firstFrameBounds.join(",") === "74,105,194,185" &&
    clawdAssetMetadata.get("crabwalking.gif").firstFrameBounds.join(",") ===
      "74,105,194,185",
  "划船 intro 必须非循环，并与 walking 首帧保持一致的光学中心",
);
{
  const racingMetadata = clawdAssetMetadata.get(
    "timetable-theme-clawd-racing-car.gif",
  );
  assert(
    [1000, 3000, 3080].every((timestamp) =>
      racingMetadata.frameStartTimesMs.includes(timestamp),
    ),
    "Racing 源必须保留完全上车、最后安全驾驶和开始下车的审计帧起点",
  );
}
{
  const introMetadata = clawdAssetMetadata.get(
    "timetable-theme-clawd-rowing-intro.gif",
  );
  const outroMetadata = clawdAssetMetadata.get(
    "timetable-theme-clawd-rowing-outro.gif",
  );
  const expectedOutroDelaysCs = [
    9, 8, 8, 9, 8, 8, 17, 17, 50, 16, 9, 16, 9, 33,
  ];
  const introFrames = gifCompositedRgbaFrames(
    path.join(timetableImageRoot, "timetable-theme-clawd-rowing-intro.gif"),
  ).frames;
  const outroFrames = gifCompositedRgbaFrames(
    path.join(timetableImageRoot, "timetable-theme-clawd-rowing-outro.gif"),
  ).frames;
  const rowingFrames = gifCompositedRgbaFrames(
    path.join(timetableImageRoot, "timetable-theme-clawd-rowing.gif"),
  ).frames;
  const walkingFrames = gifCompositedRgbaFrames(
    path.join(timetableImageRoot, "timetable-theme-clawd-walking.gif"),
  ).frames;
  assert(
    outroMetadata.frameCount === 14 &&
      outroMetadata.frameDelaysCs.join(",") ===
        expectedOutroDelaysCs.join(",") &&
      outroMetadata.hasTransparency === true &&
      outroMetadata.hasLoopExtension === false &&
      outroFrames.length === 14 &&
      introFrames.length === 14 &&
      outroFrames[0].equals(rowingFrames[0]) &&
      outroFrames
        .slice(1, 13)
        .every((frame, index) => frame.equals(introFrames[12 - index])) &&
      outroFrames[13].equals(walkingFrames[0]),
    "划船 outro 必须保留 14 帧反转时序、规范端点、12 个逆序中间帧和非循环透明输出",
  );
  assert(
    introMetadata.frameDelaysCs.slice().reverse().join(",") ===
      expectedOutroDelaysCs.join(","),
    "划船 outro 的每一帧 delay 必须与 intro 严格成对反转",
  );
}
assert(
  /\.clawd-scene-stage\s*\{[^}]*width:\s*360rpx;[^}]*height:\s*242rpx;[^}]*pointer-events:\s*none;/s.test(
    timetablePageStyles,
  ) &&
    /\.clawd-scene-media\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s.test(
      timetablePageStyles,
    ) &&
    /\.clawd-scene-media--mirrored\s*\{[^}]*transform:\s*scaleX\(-1\);/s.test(
      timetablePageStyles,
    ) &&
    !/\bscale\(/.test(clawdKeyframes) &&
    !/\b(?:width|height|top|right|bottom|left)\s*:/.test(clawdKeyframes),
  "小克动图必须在固定 360×242 舞台内切换，且交接关键帧不得缩放或改变布局尺寸",
);
assert(
  [
    "clawd-lurk-from-left",
    "clawd-lurk-from-right",
    "clawd-emerge-from-left",
    "clawd-emerge-from-right",
    "clawd-walk-exit-left",
    "clawd-walk-exit-right",
    "clawd-race-enter-left",
    "clawd-race-enter-right",
    "clawd-race-bridge-exit-left",
    "clawd-race-bridge-exit-right",
    "clawd-race-exit-left",
    "clawd-race-exit-right",
    "clawd-row-enter-left",
    "clawd-row-enter-right",
    "clawd-row-exit-left",
    "clawd-row-exit-right",
  ].every((name) => timetablePageStyles.includes(`@keyframes ${name}`)) &&
    timetablePageStyles.includes("19.07%") &&
    timetablePageStyles.includes("95.88%") &&
    !timetablePageStyles.includes("18.97%") &&
    !timetablePageStyles.includes("95.4%") &&
    timetablePageStyles.includes("8.07%") &&
    timetablePageStyles.includes("24.45%") &&
    timetablePageStyles.includes("28.61%") &&
    timetablePageStyles.includes("71.39%") &&
    timetablePageStyles.includes("73.35%") &&
    timetablePageStyles.includes("85.57%") &&
    timetablePageStyles.includes("89.73%") &&
    timetablePageStyles.includes("95.65%") &&
    timetablePageStyles.includes("animation-duration: 1940ms") &&
    timetablePageStyles.includes("animation-duration: 5580ms") &&
    timetablePageStyles.includes("animation-duration: 4090ms") &&
    timetablePageStyles.includes("animation-duration: 1840ms") &&
    timetablePageStyles.includes("cubic-bezier(0.23, 1, 0.32, 1)") &&
    timetablePageStyles.includes("cubic-bezier(0.77, 0, 0.175, 1)") &&
    timetablePageStyles.includes("7.65%"),
  "小克双向旅程必须保留 Walking、Racing 与 Rowing 的审计帧时点",
);
{
  const exactVariableFrame = (block, marker, name, fallback, opacity) =>
    new RegExp(
      `${marker}\\s*\\{[^}]*transform:\\s*${cssVariableTranslatePattern(name, fallback)};[^}]*opacity:\\s*${opacity};`,
      "s",
    ).test(block);
  const entryProfiles = [
    [
      "clawd-race-enter-left",
      [
        ["0%,\\s*24\\.45%", "--clawd-vehicle-left-far", "-560rpx", "0"],
        [
          "28\\.61%",
          "--clawd-vehicle-left-race-entry-reveal",
          "-506rpx",
          "0\\.44",
        ],
        ["61\\.12%", "--clawd-vehicle-left-decel-start", "-80rpx", "0\\.44"],
        ["63\\.57%", "--clawd-vehicle-left-easing", "-51rpx", "0\\.44"],
        ["66\\.01%", "--clawd-vehicle-left-medium", "-29rpx", "0\\.44"],
        ["68\\.46%", "--clawd-vehicle-left-small", "-13rpx", "0\\.44"],
        ["70\\.9%", "--clawd-vehicle-left-tiny", "-3rpx", "0\\.44"],
      ],
    ],
    [
      "clawd-race-enter-right",
      [
        ["0%,\\s*24\\.45%", "--clawd-vehicle-right-far", "560rpx", "0"],
        [
          "28\\.61%",
          "--clawd-vehicle-right-race-entry-reveal",
          "506rpx",
          "0\\.44",
        ],
        ["61\\.12%", "--clawd-vehicle-right-decel-start", "80rpx", "0\\.44"],
        ["63\\.57%", "--clawd-vehicle-right-easing", "51rpx", "0\\.44"],
        ["66\\.01%", "--clawd-vehicle-right-medium", "29rpx", "0\\.44"],
        ["68\\.46%", "--clawd-vehicle-right-small", "13rpx", "0\\.44"],
        ["70\\.9%", "--clawd-vehicle-right-tiny", "3rpx", "0\\.44"],
      ],
    ],
  ];
  assert(
    entryProfiles.every(([keyframeName, frames]) => {
      const block = cssBlock(timetablePageStyles, `@keyframes ${keyframeName}`);
      return (
        (block.match(/transform:\s*translateX/g) || []).length === 8 &&
        frames.every(([marker, name, fallback, opacity]) =>
          exactVariableFrame(block, marker, name, fallback, opacity),
        ) &&
        /73\.35%,\s*100%\s*\{[^}]*translateX\(0\)[^}]*opacity:\s*0\.44;/s.test(
          block,
        )
      );
    }),
    "Racing entry 必须使用自适应距离变量并保留 Plan 006 的所有时点",
  );

  const bridgeProfiles = [
    [
      "clawd-race-bridge-exit-left",
      [
        ["26\\.89%", "--clawd-vehicle-left-tiny", "-3rpx"],
        ["29\\.34%", "--clawd-vehicle-left-small", "-13rpx"],
        ["31\\.78%", "--clawd-vehicle-left-medium", "-29rpx"],
        ["34\\.23%", "--clawd-vehicle-left-easing", "-51rpx"],
        ["36\\.67%", "--clawd-vehicle-left-decel-start", "-80rpx"],
        ["71\\.39%", "--clawd-vehicle-left-race-bridge-near-edge", "-534rpx"],
        ["73\\.35%,\\s*100%", "--clawd-vehicle-left-far", "-560rpx"],
      ],
    ],
    [
      "clawd-race-bridge-exit-right",
      [
        ["26\\.89%", "--clawd-vehicle-right-tiny", "3rpx"],
        ["29\\.34%", "--clawd-vehicle-right-small", "13rpx"],
        ["31\\.78%", "--clawd-vehicle-right-medium", "29rpx"],
        ["34\\.23%", "--clawd-vehicle-right-easing", "51rpx"],
        ["36\\.67%", "--clawd-vehicle-right-decel-start", "80rpx"],
        ["71\\.39%", "--clawd-vehicle-right-race-bridge-near-edge", "534rpx"],
        ["73\\.35%,\\s*100%", "--clawd-vehicle-right-far", "560rpx"],
      ],
    ],
  ];
  assert(
    bridgeProfiles.every(([keyframeName, frames]) => {
      const block = cssBlock(timetablePageStyles, `@keyframes ${keyframeName}`);
      return (
        (block.match(/transform:\s*translateX/g) || []).length === 8 &&
        /0%,\s*24\.45%\s*\{[^}]*translateX\(0\)[^}]*opacity:\s*0\.44;/s.test(
          block,
        ) &&
        frames.every(([marker, name, fallback], index) =>
          exactVariableFrame(
            block,
            marker,
            name,
            fallback,
            index === frames.length - 1 ? "0" : "0\\.44",
          ),
        )
      );
    }),
    "bridge Racing 必须使用自适应距离变量并保留 Plan 006 的所有时点",
  );

  const piecewiseRouteClasses = cssBlock(
    timetablePageStyles,
    ".clawd-scene-motion--race-enter-left",
  );
  const finalRouteClasses = cssBlock(
    timetablePageStyles,
    ".clawd-scene-motion--race-exit-left",
  );
  assert(
    [
      ".clawd-scene-motion--race-enter-left",
      ".clawd-scene-motion--race-enter-right",
      ".clawd-scene-motion--race-bridge-exit-left",
      ".clawd-scene-motion--race-bridge-exit-right",
    ].every((selector) => piecewiseRouteClasses.includes(selector)) &&
      piecewiseRouteClasses.includes("animation-timing-function: linear") &&
      !piecewiseRouteClasses.includes("cubic-bezier") &&
      finalRouteClasses.includes(
        "animation-timing-function: cubic-bezier(0.77, 0, 0.175, 1)",
      ) &&
      !finalRouteClasses.includes("animation-timing-function: linear"),
    "分段 Racing entry/bridge 必须使用 linear，final Racing 必须保留原强曲线",
  );
  assert(
    [
      ["clawd-scene-motion--race-enter-left", "clawd-race-enter-left"],
      ["clawd-scene-motion--race-enter-right", "clawd-race-enter-right"],
      [
        "clawd-scene-motion--race-bridge-exit-left",
        "clawd-race-bridge-exit-left",
      ],
      [
        "clawd-scene-motion--race-bridge-exit-right",
        "clawd-race-bridge-exit-right",
      ],
    ].every(([motionClass, keyframeName]) =>
      new RegExp(
        `\\.${motionClass}\\s*\\{[^}]*animation-name:\\s*${keyframeName};`,
        "s",
      ).test(timetablePageStyles),
    ),
    "Racing 分段速度 keyframe 必须只绑定到对应 entry 与 bridge-only class",
  );
}
assert(
  [
    [
      "clawd-race-exit-left",
      "--clawd-vehicle-left-race-exit-near",
      "-430rpx",
      "--clawd-vehicle-left-far",
      "-560rpx",
    ],
    [
      "clawd-race-exit-right",
      "--clawd-vehicle-right-race-exit-near",
      "430rpx",
      "--clawd-vehicle-right-far",
      "560rpx",
    ],
  ].every(
    ([
      keyframeName,
      nearEdgeVariable,
      nearEdgeFallback,
      offscreenVariable,
      offscreenFallback,
    ]) => {
      const block = cssBlock(timetablePageStyles, `@keyframes ${keyframeName}`);
      return (
        /0%,\s*8\.07%\s*\{[^}]*translateX\(0\)[^}]*opacity:\s*0\.44;/s.test(
          block,
        ) &&
        new RegExp(
          `85\\.57%\\s*\\{[^}]*${cssVariableTranslatePattern(nearEdgeVariable, nearEdgeFallback)}[^}]*opacity:\\s*0\\.44;`,
          "s",
        ).test(block) &&
        new RegExp(
          `89\\.73%,\\s*100%\\s*\\{[^}]*${cssVariableTranslatePattern(offscreenVariable, offscreenFallback)}[^}]*opacity:\\s*0;`,
          "s",
        ).test(block)
      );
    },
  ) &&
    [
      ["clawd-scene-motion--race-exit-left", "clawd-race-exit-left"],
      ["clawd-scene-motion--race-exit-right", "clawd-race-exit-right"],
    ].every(([motionClass, keyframeName]) =>
      new RegExp(
        `\\.${motionClass}\\s*\\{[^}]*animation-name:\\s*${keyframeName};`,
        "s",
      ).test(timetablePageStyles),
    ),
  "final standalone Racing 必须保留原时点和强曲线，并只把距离改为自适应变量",
);
assert(
  [
    [
      "clawd-row-enter-left",
      "--clawd-vehicle-left-far",
      "-560rpx",
      "--clawd-vehicle-left-row-near",
      "-460rpx",
    ],
    [
      "clawd-row-enter-right",
      "--clawd-vehicle-right-far",
      "560rpx",
      "--clawd-vehicle-right-row-near",
      "460rpx",
    ],
  ].every(
    ([keyframeName, farVariable, farFallback, nearVariable, nearFallback]) => {
      const block = cssBlock(timetablePageStyles, `@keyframes ${keyframeName}`);
      return (
        new RegExp(
          `0%\\s*\\{[^}]*${cssVariableTranslatePattern(farVariable, farFallback)}[^}]*opacity:\\s*0;`,
          "s",
        ).test(block) &&
        new RegExp(
          `7\\.65%\\s*\\{[^}]*${cssVariableTranslatePattern(nearVariable, nearFallback)}[^}]*opacity:\\s*0\\.44;`,
          "s",
        ).test(block) &&
        /95\.65%,\s*100%\s*\{[^}]*translateX\(0\)[^}]*opacity:\s*0\.44;/s.test(
          block,
        )
      );
    },
  ) &&
    [
      ["clawd-scene-motion--row-enter-left", "clawd-row-enter-left"],
      ["clawd-scene-motion--row-enter-right", "clawd-row-enter-right"],
    ].every(([motionClass, keyframeName]) =>
      new RegExp(
        `\\.${motionClass}\\s*\\{[^}]*animation-name:\\s*${keyframeName};`,
        "s",
      ).test(timetablePageStyles),
    ) &&
    [
      [
        "clawd-row-exit-left",
        "--clawd-vehicle-left-row-near",
        "-460rpx",
        "--clawd-vehicle-left-far",
        "-560rpx",
      ],
      [
        "clawd-row-exit-right",
        "--clawd-vehicle-right-row-near",
        "460rpx",
        "--clawd-vehicle-right-far",
        "560rpx",
      ],
    ].every(
      ([
        keyframeName,
        nearVariable,
        nearFallback,
        farVariable,
        farFallback,
      ]) => {
        const block = cssBlock(
          timetablePageStyles,
          `@keyframes ${keyframeName}`,
        );
        return (
          new RegExp(
            `88%\\s*\\{[^}]*${cssVariableTranslatePattern(nearVariable, nearFallback)}[^}]*opacity:\\s*0\\.44;`,
            "s",
          ).test(block) &&
          new RegExp(
            `95\\.65%,\\s*100%\\s*\\{[^}]*${cssVariableTranslatePattern(farVariable, farFallback)}[^}]*opacity:\\s*0;`,
            "s",
          ).test(block)
        );
      },
    ),
  "Rowing 双向路线必须使用自适应车辆距离并保留 80ms handoff",
);
assert(
  [
    [
      "clawd-lurk-from-left",
      "--clawd-lurk-left-hold",
      "-195rpx",
      "--clawd-walk-left-far",
      "-470rpx",
    ],
    [
      "clawd-lurk-from-right",
      "--clawd-lurk-right-hold",
      "195rpx",
      "--clawd-walk-right-far",
      "470rpx",
    ],
  ].every(
    ([keyframeName, holdVariable, holdFallback, farVariable, farFallback]) => {
      const block = cssBlock(timetablePageStyles, `@keyframes ${keyframeName}`);
      const exactFrame = (marker, variable, fallback) =>
        new RegExp(
          `${marker}\\s*\\{[^}]*transform:\\s*${cssVariableTranslatePattern(variable, fallback)};[^}]*opacity:\\s*0\\.38;`,
          "s",
        ).test(block);
      return (
        exactFrame("0%", farVariable, farFallback) &&
        exactFrame("5\\.38%", holdVariable, holdFallback) &&
        exactFrame("94\\.62%", holdVariable, holdFallback) &&
        exactFrame("100%", farVariable, farFallback)
      );
    },
  ) &&
    [
      [
        "clawd-emerge-from-left",
        "--clawd-walk-left-far",
        "-470rpx",
        "--clawd-walk-left-reveal",
        "-414rpx",
      ],
      [
        "clawd-emerge-from-right",
        "--clawd-walk-right-far",
        "470rpx",
        "--clawd-walk-right-reveal",
        "414rpx",
      ],
    ].every(
      ([
        keyframeName,
        farVariable,
        farFallback,
        revealVariable,
        revealFallback,
      ]) => {
        const block = cssBlock(
          timetablePageStyles,
          `@keyframes ${keyframeName}`,
        );
        return (
          new RegExp(
            `0%,\\s*19\\.07%\\s*\\{[^}]*${cssVariableTranslatePattern(farVariable, farFallback)}[^}]*opacity:\\s*0;`,
            "s",
          ).test(block) &&
          new RegExp(
            `28%\\s*\\{[^}]*${cssVariableTranslatePattern(revealVariable, revealFallback)}[^}]*opacity:\\s*0\\.44;`,
            "s",
          ).test(block)
        );
      },
    ) &&
    [
      [
        "clawd-walk-exit-left",
        "--clawd-walk-left-near",
        "-390rpx",
        "--clawd-walk-left-far",
        "-470rpx",
      ],
      [
        "clawd-walk-exit-right",
        "--clawd-walk-right-near",
        "390rpx",
        "--clawd-walk-right-far",
        "470rpx",
      ],
    ].every(
      ([
        keyframeName,
        nearVariable,
        nearFallback,
        farVariable,
        farFallback,
      ]) => {
        const block = cssBlock(
          timetablePageStyles,
          `@keyframes ${keyframeName}`,
        );
        return (
          new RegExp(
            `84%\\s*\\{[^}]*${cssVariableTranslatePattern(nearVariable, nearFallback)}[^}]*opacity:\\s*0\\.44;`,
            "s",
          ).test(block) &&
          new RegExp(
            `95\\.88%,\\s*100%\\s*\\{[^}]*${cssVariableTranslatePattern(farVariable, farFallback)}[^}]*opacity:\\s*0;`,
            "s",
          ).test(block)
        );
      },
    ) &&
    ![
      "clawd-soft-arrive",
      "clawd-soft-depart",
      "clawd-wave-full",
      "clawd-jump-full",
      "clawd-dance-full",
      "clawd-laptop-full",
      "clawd-magnifier-full",
      "clawd-peek-once",
    ].some((name) => timetablePageStyles.includes(name)),
  "Lurking 与 Walking 必须使用自适应边缘变量，并保持完整探出/离场时点",
);
assert(
  timetablePageScript.includes("CLAWD_QUIET_RANGE_MS = [900, 2800]") &&
    timetablePageScript.includes("CLAWD_STOP_COLUMN_COUNT = 7") &&
    timetablePageScript.includes("CLAWD_STOP_ROW_COUNT = 7") &&
    timetablePageScript.includes("CLAWD_STOP_POOL_SIZE = 6") &&
    timetablePageScript.includes("clawdStopCandidates(") &&
    timetablePageScript.includes("drawClawdStopPoint(") &&
    timetablePageScript.includes("drawClawdEntryEdge(") &&
    timetablePageScript.includes("CLAWD_WEIGHTED_ARRIVALS") &&
    timetablePageScript.includes("CLAWD_ACTION_BLOCK_SIZES") &&
    timetablePageScript.includes("CLAWD_BRIDGE_COUNTS") &&
    timetablePageScript.includes("CLAWD_WEIGHTED_BRIDGE_MODES") &&
    timetablePageScript.includes("CLAWD_WEIGHTED_DEPARTURES") &&
    timetablePageScript.includes("createClawdJourneyPlanner") &&
    timetablePageScript.includes("buildClawdJourney") &&
    timetablePageScript.includes("fisherYatesShuffle") &&
    timetablePageScript.includes("randomIntegerInclusive(") &&
    timetablePageScript.includes(
      "for (let index = shuffled.length - 1; index > 0; index -= 1)",
    ) &&
    timetablePageScript.includes("exitEdgeRunLength >= 2") &&
    timetablePageScript.includes("entryEdgeRunLength >= 2") &&
    timetablePageScript.includes("previousRunLength < 2") &&
    timetablePageScript.includes("if (step.restartOffscreen)") &&
    timetablePageScript.includes("!previousStep.exitOffscreen") &&
    timetablePageScript.includes('previousStep.kind !== "bridge-exit"') &&
    timetablePageScript.includes("previousStep.scene !== step.scene") &&
    timetablePageScript.includes(
      "previousStep.positionStyle !== step.positionStyle",
    ) &&
    timetablePageScript.includes('kind === "bridge-exit"') &&
    timetablePageScript.includes('"clawd-scene-motion--race-bridge-exit-"') &&
    timetablePageScript.includes("mountStep();") &&
    timetablePageScript.includes("if (!step.exitOffscreen") &&
    timetablePageScript.includes("clawdActiveJourney = null") &&
    !timetablePageScript.includes("CLAWD_SCENE_VIGNETTES") &&
    !timetablePageScript.includes("CLAWD_SCENE_SEQUENCES") &&
    !timetablePageScript.includes("clawdSequenceIndex") &&
    !timetablePageScript.includes("CLAWD_ENTRY_POINTS") &&
    !timetablePageScript.includes("entryPointBag") &&
    !timetablePageScript.includes("clawdAnchorPositionClass") &&
    !timetablePageScript.includes("selectAllComponents(") &&
    !timetablePageScript.includes("createSelectorQuery(") &&
    !timetablePageScript.includes("setInterval(") &&
    !timetablePageScript.includes("requestAnimationFrame(") &&
    !/sort\([^)]*Math\.random/.test(timetablePageScript),
  "小克旅程必须由小型 Fisher–Yates 袋运行时组合，并只在真实离屏后进入短静默",
);
{
  let randomState = 0x5eed1234;
  const nextRandom = () => {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  const scheduler = loadClawdScheduler(timetablePageScript, nextRandom);
  const emptyStopLayoutInput = {
    courses: [],
    maxPeriod: 12,
    headerHeightPx: 64,
    metrics: {
      rowHeightPx: 72,
      courseTopInsetPx: 4,
      courseHeightExtensionPx: 3,
      scale: 1,
    },
  };
  const planner = scheduler.createClawdJourneyPlanner();
  const journeys = Array.from({ length: 200 }, () =>
    scheduler.buildClawdJourney(planner, emptyStopLayoutInput, nextRandom),
  );
  const arrivalModes = journeys.map(({ arrivalMode }) => arrivalMode);
  const bridgeCounts = journeys.map(({ bridgeCount }) => bridgeCount);
  const bridgeModes = journeys.flatMap(({ bridgeModes: modes }) => modes);
  const actionBlocks = journeys.flatMap(({ actionBlocks: blocks }) => blocks);
  const entryEdges = journeys.map(({ entryEdge }) => entryEdge);
  const routeExitEdges = journeys.flatMap(({ steps }) =>
    steps
      .filter((step) => step.kind === "bridge-exit" || step.kind === "exit")
      .map((step) => (step.motionClass.endsWith("-left") ? "left" : "right")),
  );
  const departureModes = journeys.map(({ departureMode }) => departureMode);
  const actions = journeys.flatMap(({ actionNames }) => actionNames);
  const maximumRunLength = (values) => {
    let maximum = 0;
    let current = 0;
    let previous = null;
    values.forEach((value) => {
      current = value === previous ? current + 1 : 1;
      previous = value;
      maximum = Math.max(maximum, current);
    });
    return maximum;
  };

  const seededRandom = (seed) => {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  };
  const parseClawdPositionStyle = (style) =>
    Object.fromEntries(
      style
        .split(";")
        .map((declaration) => declaration.trim())
        .filter(Boolean)
        .map((declaration) => {
          const separator = declaration.indexOf(":");
          return [
            declaration.slice(0, separator).trim(),
            Number(
              declaration
                .slice(separator + 1)
                .trim()
                .replace(/rpx$/, ""),
            ),
          ];
        }),
    );
  const nearlyEqual = (left, right, tolerance = 0.01) =>
    Math.abs(left - right) <= tolerance;

  const adaptiveRandom = seededRandom(0x7a11ce55);
  const adaptivePlanner = scheduler.createClawdJourneyPlanner();
  const adaptiveJourneys = Array.from({ length: 420 }, () =>
    scheduler.buildClawdJourney(
      adaptivePlanner,
      emptyStopLayoutInput,
      adaptiveRandom,
    ),
  );
  const adaptiveStops = adaptiveJourneys.map(({ stopPoint }) => stopPoint);
  const adaptiveEntryEdges = adaptiveJourneys.map(({ entryEdge }) => entryEdge);
  const emptyGeometry = scheduler.clawdStopLayoutGeometry(emptyStopLayoutInput);
  assert(
    new Set(adaptiveStops.map(({ columnIndex }) => columnIndex)).size === 7 &&
      new Set(adaptiveStops.map(({ rowIndex }) => rowIndex)).size === 7 &&
      new Set(adaptiveStops.map(({ cellKey }) => cellKey)).size === 49 &&
      new Set(adaptiveStops.map(({ centerXRpx }) => centerXRpx.toFixed(2)))
        .size >= 30 &&
      new Set(adaptiveStops.map(({ baselineYRpx }) => baselineYRpx.toFixed(2)))
        .size >= 30 &&
      adaptiveStops.every(
        (stop, index) =>
          index === 0 || stop.cellKey !== adaptiveStops[index - 1].cellKey,
      ),
    "空课表的自适应停靠必须覆盖 7×7 全部 cell、产生连续二维坐标且不紧邻重复 cell",
  );
  assert(
    maximumRunLength(adaptiveEntryEdges) <= 2 &&
      adaptiveEntryEdges.some(
        (edge, index) => index > 0 && edge === adaptiveEntryEdges[index - 1],
      ) &&
      adaptiveEntryEdges.some(
        (edge, index) => index > 0 && edge !== adaptiveEntryEdges[index - 1],
      ),
    "自适应旅程的 entry edge 必须允许随机同侧重复与换侧，但连续同侧不得超过两次",
  );
  assert(
    adaptiveStops.every((stop) => {
      const decodedStyle = parseClawdPositionStyle(stop.positionStyle);
      return (
        stop.centerXRpx >= 148 &&
        stop.centerXRpx <= 602 &&
        stop.baselineYRpx >= emptyGeometry.minimumBaselineRpx &&
        stop.baselineYRpx <= emptyGeometry.maximumBaselineRpx &&
        Object.keys(decodedStyle).length === 30 &&
        Object.values(decodedStyle).every(Number.isFinite) &&
        nearlyEqual(decodedStyle.left, stop.stageLeftRpx) &&
        nearlyEqual(decodedStyle.top, stop.stageTopRpx)
      );
    }),
    "所有停靠坐标必须处于安全范围，且 left/top 与每个自适应 route 变量均为有限两位数值",
  );

  const courseFixture = (weekday, periodStart, periodEnd) => ({
    weekday,
    periodStart,
    periodEnd,
  });
  const upperDenseInput = {
    ...emptyStopLayoutInput,
    courses: Array.from({ length: 7 }, (_, index) =>
      courseFixture(index + 1, 1, 6),
    ),
  };
  const lowerDenseInput = {
    ...emptyStopLayoutInput,
    courses: Array.from({ length: 7 }, (_, index) =>
      courseFixture(index + 1, 7, 12),
    ),
  };
  const drawDenseStops = (input, seed) => {
    const planner = scheduler.createClawdJourneyPlanner();
    const sourceRandom = seededRandom(seed);
    return Array.from({ length: 80 }, () => {
      const drawValues = [];
      const recordingRandom = () => {
        const value = sourceRandom();
        drawValues.push(value);
        return value;
      };
      const selected = scheduler.drawClawdStopPoint(
        planner,
        input,
        recordingRandom,
      );
      const geometry = scheduler.clawdStopLayoutGeometry(input);
      const horizontalPhaseRpx = (drawValues[0] * 2 - 1) * 22;
      const verticalPhaseRpx =
        (drawValues[1] * 2 - 1) * geometry.verticalPhaseLimitRpx;
      const ranked = scheduler
        .clawdStopCandidates(input, horizontalPhaseRpx, verticalPhaseRpx)
        .slice()
        .sort((left, right) => left.obstructionScore - right.obstructionScore);
      return {
        selected,
        sixthLowestScore: ranked[5].obstructionScore,
      };
    });
  };
  const upperDenseStops = drawDenseStops(upperDenseInput, 0x77110001);
  const lowerDenseStops = drawDenseStops(lowerDenseInput, 0x77110002);
  const baselineMidpoint =
    (emptyGeometry.minimumBaselineRpx + emptyGeometry.maximumBaselineRpx) / 2;
  assert(
    upperDenseStops.every(
      ({ selected, sixthLowestScore }) =>
        selected.obstructionScore <= sixthLowestScore + 0.000001,
    ) &&
      upperDenseStops.every(
        ({ selected }) => selected.baselineYRpx > baselineMidpoint,
      ) &&
      lowerDenseStops.every(
        ({ selected, sixthLowestScore }) =>
          selected.obstructionScore <= sixthLowestScore + 0.000001,
      ) &&
      lowerDenseStops.every(
        ({ selected }) => selected.baselineYRpx < baselineMidpoint,
      ),
    "上下半区密集课程必须把随机选择限制在六个最低分候选，并分别偏向开放的下/上半区",
  );

  const singleCourseInput = {
    ...emptyStopLayoutInput,
    courses: [courseFixture(3, 4, 5)],
  };
  const singleCourseRectangles =
    scheduler.clawdVisibleCourseRectangles(singleCourseInput);
  const dayWidthRpx = 666 / 7;
  const expectedCourseRectangle = {
    left: 74 + dayWidthRpx * 2,
    right: 74 + dayWidthRpx * 3,
    top: 368,
    bottom: 515,
  };
  const expectedCoreOverlap = (expectedCourseRectangle.right - 271) * 147;
  const expectedHaloOverlap = dayWidthRpx * 147;
  const expectedWeightedScore =
    expectedCoreOverlap + (expectedHaloOverlap - expectedCoreOverlap) * 0.22;
  assert(
    singleCourseRectangles.length === 1 &&
      Object.entries(expectedCourseRectangle).every(([property, value]) =>
        nearlyEqual(singleCourseRectangles[0][property], value),
      ) &&
      nearlyEqual(
        scheduler.clawdRectangleIntersectionArea(
          { left: 271, top: 346, right: 519, bottom: 542 },
          singleCourseRectangles[0],
        ),
        expectedCoreOverlap,
      ) &&
      nearlyEqual(
        scheduler.clawdStopObstructionScore(200, 300, singleCourseRectangles),
        expectedWeightedScore,
      ),
    "单课程 fixture 必须按真实网格矩形精确计算 core 与额外 halo 的加权交叠面积",
  );
  assert(
    scheduler.clawdVisibleCourseRectangles({
      ...emptyStopLayoutInput,
      courses: [
        courseFixture(0, 1, 2),
        courseFixture(8, 1, 2),
        courseFixture(2, Number.NaN, 2),
        courseFixture(2, 4, Number.POSITIVE_INFINITY),
        courseFixture(2, 7, 3),
      ],
    }).length === 0,
    "非法 weekday、非有限 period 与反向 period range 必须被忽略而不能污染停靠评分",
  );

  const changingFixturePlanner = scheduler.createClawdJourneyPlanner();
  const changingFixtureRandom = seededRandom(0x7711f17e);
  const upperJourney = scheduler.buildClawdJourney(
    changingFixturePlanner,
    upperDenseInput,
    changingFixtureRandom,
  );
  const retainedUpperStyle = upperJourney.stopPoint.positionStyle;
  const lowerJourney = scheduler.buildClawdJourney(
    changingFixturePlanner,
    lowerDenseInput,
    changingFixtureRandom,
  );
  assert(
    upperJourney.stopPoint.positionStyle === retainedUpperStyle &&
      upperJourney.stopPoint.baselineYRpx > baselineMidpoint &&
      lowerJourney.stopPoint.baselineYRpx < baselineMidpoint &&
      lowerJourney.stopPoint.positionStyle !== retainedUpperStyle,
    "课程分布变化只能影响下一条旅程，先前返回的旅程与 position style 不得被原地改写",
  );

  const routeCenters = [150, 375, 600];
  routeCenters.forEach((centerXRpx) => {
    const routeStyle = parseClawdPositionStyle(
      scheduler.clawdStopPositionStyle(centerXRpx, 560),
    );
    const stageLeftRpx = centerXRpx - 180;
    assert(
      nearlyEqual(centerXRpx + routeStyle["--clawd-walk-left-far"] + 95, 0) &&
        nearlyEqual(
          centerXRpx + routeStyle["--clawd-walk-right-far"] - 95,
          750,
        ) &&
        nearlyEqual(
          centerXRpx + routeStyle["--clawd-vehicle-left-far"] + 185,
          0,
        ) &&
        nearlyEqual(
          centerXRpx + routeStyle["--clawd-vehicle-right-far"] - 185,
          750,
        ) &&
        nearlyEqual(stageLeftRpx + routeStyle["--clawd-lurk-left-hold"], 0) &&
        nearlyEqual(
          stageLeftRpx +
            routeStyle["--clawd-lurk-right-hold"] +
            scheduler.CLAWD_STAGE_WIDTH_RPX,
          750,
        ),
      `x=${centerXRpx} 的 Walking/vehicle 隐藏端点与 Lurking hold 必须精确贴合两侧屏幕边缘`,
    );
  });

  const centeredRouteStyle = parseClawdPositionStyle(
    scheduler.clawdStopPositionStyle(375, 560),
  );
  const centeredRouteExpectations = {
    left: 195,
    top: 318,
    "--clawd-walk-left-far": -470,
    "--clawd-walk-right-far": 470,
    "--clawd-walk-left-reveal": -414,
    "--clawd-walk-right-reveal": 414,
    "--clawd-walk-left-near": -390,
    "--clawd-walk-right-near": 390,
    "--clawd-lurk-left-hold": -195,
    "--clawd-lurk-right-hold": 195,
    "--clawd-vehicle-left-far": -560,
    "--clawd-vehicle-right-far": 560,
    "--clawd-vehicle-left-tiny": -3,
    "--clawd-vehicle-right-tiny": 3,
    "--clawd-vehicle-left-small": -13,
    "--clawd-vehicle-right-small": 13,
    "--clawd-vehicle-left-medium": -29,
    "--clawd-vehicle-right-medium": 29,
    "--clawd-vehicle-left-easing": -51,
    "--clawd-vehicle-right-easing": 51,
    "--clawd-vehicle-left-decel-start": -80,
    "--clawd-vehicle-right-decel-start": 80,
    "--clawd-vehicle-left-race-exit-near": -430,
    "--clawd-vehicle-right-race-exit-near": 430,
    "--clawd-vehicle-left-row-near": -460,
    "--clawd-vehicle-right-row-near": 460,
    "--clawd-vehicle-left-race-entry-reveal": -506,
    "--clawd-vehicle-right-race-entry-reveal": 506,
    "--clawd-vehicle-left-race-bridge-near-edge": -534,
    "--clawd-vehicle-right-race-bridge-near-edge": 534,
  };
  assert(
    Object.entries(centeredRouteExpectations).every(([property, value]) =>
      nearlyEqual(centeredRouteStyle[property], value),
    ),
    "中心 x=375 必须逐项复现 Plan 006 的全部固定路线距离",
  );

  const segmentVelocities = (times, positions) =>
    positions
      .slice(1)
      .map(
        (position, index) =>
          Math.abs(position - positions[index]) /
          ((times[index + 1] - times[index]) / 1000),
      );
  const nondecreasing = (values, tolerance = 0) =>
    values.every(
      (value, index) => index === 0 || value + tolerance >= values[index - 1],
    );
  const nonincreasing = (values, tolerance = 0) =>
    values.every(
      (value, index) => index === 0 || value <= values[index - 1] + tolerance,
    );
  const approximatelyConstant = (values, tolerance) =>
    Math.max(...values) - Math.min(...values) <= tolerance;
  const entryTimesMs = [1000, 1170, 2500, 2600, 2700, 2800, 2900, 3000];
  const bridgeTimesMs = [1000, 1100, 1200, 1300, 1400, 1500, 2920, 3000];
  routeCenters.forEach((centerXRpx) => {
    const routeStyle = parseClawdPositionStyle(
      scheduler.clawdStopPositionStyle(centerXRpx, 560),
    );
    ["left", "right"].forEach((edge) => {
      const prefix = `--clawd-vehicle-${edge}`;
      const farDistance = Math.abs(routeStyle[`${prefix}-far`]);
      const normalize = (property) =>
        Math.abs(routeStyle[`${prefix}-${property}`]) / farDistance;
      const entryPositions = [
        1,
        normalize("race-entry-reveal"),
        normalize("decel-start"),
        normalize("easing"),
        normalize("medium"),
        normalize("small"),
        normalize("tiny"),
        0,
      ];
      const entryVelocities = segmentVelocities(entryTimesMs, entryPositions);
      const bridgePositions = [
        0,
        normalize("tiny"),
        normalize("small"),
        normalize("medium"),
        normalize("easing"),
        normalize("decel-start"),
        normalize("race-bridge-near-edge"),
        1,
      ];
      const bridgeVelocities = segmentVelocities(
        bridgeTimesMs,
        bridgePositions,
      );
      assert(
        approximatelyConstant(entryVelocities.slice(0, 2), 0.006) &&
          nonincreasing([...entryVelocities.slice(2), 0], 0.0001) &&
          nondecreasing(bridgeVelocities, 0.0001) &&
          approximatelyConstant(bridgeVelocities.slice(5), 0.012),
        `x=${centerXRpx} ${edge} Racing 的归一化速度必须保持匀速→减速与加速→匀速形状`,
      );
    });
  });

  const inactiveJourneyBuild = cssBlock(
    timetablePageScript,
    "if (!clawdActiveJourney)",
  );
  assert(
    inactiveJourneyBuild.includes("courses: visibleCourses") &&
      inactiveJourneyBuild.includes("this.data.periodRows.length") &&
      inactiveJourneyBuild.includes("this.data.headerHeight") &&
      inactiveJourneyBuild.includes("timetableGridLayoutMetrics(") &&
      (timetablePageScript.match(/clawdScenePositionStyle:/g) || []).length ===
        2 &&
      (
        timetablePageTemplate.match(
          /style="\{\{clawdScenePositionStyle\}\}"/g,
        ) || []
      ).length === 1 &&
      (timetablePageScript.match(/let clawdSceneTimer:/g) || []).length === 1 &&
      (timetablePageScript.match(/clawdSceneTimer = setTimeout/g) || [])
        .length === 2,
    "最新课表几何只能在无 active journey 时读取，且一个 journey 只能挂载一个稳定 position style",
  );

  for (let index = 0; index + 5 <= arrivalModes.length; index += 5) {
    assert(
      arrivalModes
        .slice(index, index + 5)
        .sort()
        .join(",") === "lurking,racing,rowing,walking,walking",
      "每个到场袋必须包含 lurking、racing、rowing 各一次和 walking 两次",
    );
  }
  assert(
    new Set(arrivalModes).size === 4 &&
      maximumRunLength(arrivalModes) <= 2 &&
      arrivalModes.filter((mode) => mode !== "lurking").length /
        arrivalModes.length ===
        0.8,
    "到场模式必须覆盖四类、最多连续两次，且精确 80% 不经 Lurking",
  );
  for (let index = 0; index + 5 <= bridgeCounts.length; index += 5) {
    assert(
      bridgeCounts
        .slice(index, index + 5)
        .sort((left, right) => left - right)
        .join(",") === "0,0,1,1,2",
      "每个 bridge-count 袋必须精确包含 0、0、1、1、2",
    );
  }
  assert(
    new Set(bridgeCounts).size === 3,
    "确定性 passage 必须覆盖零、一次和两次 bridge",
  );
  for (let index = 0; index + 4 <= bridgeModes.length; index += 4) {
    assert(
      bridgeModes
        .slice(index, index + 4)
        .sort()
        .join(",") === "racing,racing,walking,walking",
      "每个 bridge-mode 袋必须包含两次 walking 与两次 racing",
    );
  }
  assert(
    maximumRunLength(bridgeModes) <= 2 &&
      bridgeModes.some(
        (mode, index) => index > 0 && mode === bridgeModes[index - 1],
      ),
    "bridge 模式最多连续两次，且不能退化为严格交替",
  );
  for (let index = 0; index + 5 <= actionBlocks.length; index += 5) {
    assert(
      actionBlocks
        .slice(index, index + 5)
        .map((block) => block.length)
        .sort((left, right) => left - right)
        .join(",") === "1,1,2,2,3",
      "每个 action-block-size 袋必须精确包含 1、1、2、2、3",
    );
  }

  assert(
    journeys.length >= 200 &&
      new Set(entryEdges).size === 2 &&
      new Set(routeExitEdges).size === 2 &&
      maximumRunLength(entryEdges) <= 2 &&
      entryEdges.some(
        (edge, index) => index > 0 && edge === entryEdges[index - 1],
      ) &&
      entryEdges.some(
        (edge, index) => index > 0 && edge !== entryEdges[index - 1],
      ),
    "到场方向必须独立覆盖双向、允许同侧重复但最多连续两次，且不得退化为严格交替",
  );
  assert(
    maximumRunLength(routeExitEdges) <= 2 &&
      routeExitEdges.some(
        (edge, index) => index > 0 && edge === routeExitEdges[index - 1],
      ),
    "离场方向最多连续两次，并且不能退化为严格左右交替",
  );
  for (let index = 0; index + 4 <= departureModes.length; index += 4) {
    assert(
      departureModes
        .slice(index, index + 4)
        .sort()
        .join(",") === "racing,rowing,walking,walking",
      "每个离场袋必须包含两次 walking、一次 racing 和一次 rowing",
    );
  }
  assert(
    maximumRunLength(departureModes.filter((mode) => mode === "walking")) >=
      1 &&
      maximumRunLength(departureModes) <= 2 &&
      departureModes.every(
        (mode, index) =>
          index === 0 ||
          mode === "walking" ||
          mode !== departureModes[index - 1],
      ) &&
      departureModes.some(
        (mode, index) =>
          index > 0 && mode === "walking" && departureModes[index - 1] === mode,
      ),
    "离场袋必须允许最多两次连续 walking，同时避免车辆或划船同类连发",
  );
  for (let index = 0; index + 5 <= actions.length; index += 5) {
    assert(
      new Set(actions.slice(index, index + 5)).size === 5,
      "每个动作袋必须在补充前覆盖五种动作",
    );
  }
  assert(
    actions.every(
      (action, index) => index === 0 || action !== actions[index - 1],
    ),
    "相邻动作抽取不得重复同一动作",
  );

  const oppositeEdge = (edge) => (edge === "left" ? "right" : "left");
  const routeEdge = (step) =>
    step.motionClass.endsWith("-left") ? "left" : "right";
  const travelDuration = (mode) =>
    mode === "walking"
      ? scheduler.CLAWD_WALKING_DURATION_MS
      : scheduler.CLAWD_RACING_DURATION_MS;
  const travelMediaClass = (edge, entering) => {
    const direction = entering ? oppositeEdge(edge) : edge;
    return direction === "left" ? "clawd-scene-media--mirrored" : "";
  };
  const travelMotionClass = (mode, route, edge, bridgeExit = false) => {
    if (mode === "walking") {
      return route === "enter"
        ? `clawd-scene-motion--emerge-from-${edge}`
        : `clawd-scene-motion--walk-exit-${edge}`;
    }
    return route === "enter"
      ? `clawd-scene-motion--race-enter-${edge}`
      : bridgeExit
        ? `clawd-scene-motion--race-bridge-exit-${edge}`
        : `clawd-scene-motion--race-exit-${edge}`;
  };
  const actionDurations = {
    waving: scheduler.CLAWD_WAVING_DURATION_MS,
    jumping: scheduler.CLAWD_JUMPING_DURATION_MS,
    dancing: scheduler.CLAWD_DANCING_DURATION_MS,
    laptop: scheduler.CLAWD_LAPTOP_DURATION_MS,
    magnifier: scheduler.CLAWD_MAGNIFIER_DURATION_MS,
  };

  journeys.forEach((journey) => {
    const { steps } = journey;
    const first = steps[0];
    const last = steps[steps.length - 1];
    const positionStyle = journey.stopPoint.positionStyle;
    const entryMediaClass = travelMediaClass(journey.entryEdge, true);
    let cursor = 0;

    if (journey.arrivalMode === "lurking") {
      const lurking = steps[cursor];
      const arrival = steps[cursor + 1];
      assert(
        lurking.kind === "lurking" &&
          lurking.scene === "lurking" &&
          lurking.durationMs === scheduler.CLAWD_LURKING_DURATION_MS &&
          lurking.motionClass ===
            `clawd-scene-motion--lurk-from-${journey.entryEdge}` &&
          lurking.mediaClass === entryMediaClass &&
          lurking.exitOffscreen === false &&
          lurking.restartOffscreen === false &&
          arrival.kind === "arrival" &&
          arrival.scene === "walking" &&
          arrival.durationMs === scheduler.CLAWD_WALKING_DURATION_MS &&
          arrival.motionClass ===
            travelMotionClass("walking", "enter", journey.entryEdge) &&
          arrival.mediaClass === entryMediaClass &&
          arrival.exitOffscreen === false &&
          arrival.restartOffscreen === false,
        "Lurking 到场必须完整收回后从同侧同高度以 Walking 入场",
      );
      cursor += 2;
    } else if (journey.arrivalMode === "rowing") {
      const arrival = steps[cursor];
      const outro = steps[cursor + 1];
      assert(
        arrival.kind === "arrival" &&
          arrival.scene === "rowing" &&
          arrival.durationMs === scheduler.CLAWD_ROWING_DURATION_MS &&
          arrival.motionClass ===
            `clawd-scene-motion--row-enter-${journey.entryEdge}` &&
          arrival.mediaClass === entryMediaClass &&
          arrival.exitOffscreen === false &&
          arrival.restartOffscreen === false &&
          outro.kind === "rowing-outro" &&
          outro.scene === "rowing-outro" &&
          outro.durationMs === scheduler.CLAWD_ROWING_OUTRO_DURATION_MS &&
          outro.motionClass === "clawd-scene-motion--anchored" &&
          outro.positionStyle === arrival.positionStyle &&
          outro.mediaClass === arrival.mediaClass &&
          outro.exitOffscreen === false &&
          outro.restartOffscreen === false,
        "Rowing 到场必须由同向同高度 row-enter 无闪交接非循环 outro",
      );
      cursor += 2;
    } else {
      const arrival = steps[cursor];
      assert(
        arrival.kind === "arrival" &&
          arrival.scene === journey.arrivalMode &&
          arrival.durationMs === travelDuration(journey.arrivalMode) &&
          arrival.motionClass ===
            travelMotionClass(
              journey.arrivalMode,
              "enter",
              journey.entryEdge,
            ) &&
          arrival.mediaClass === entryMediaClass &&
          arrival.exitOffscreen === false &&
          arrival.restartOffscreen === false,
        "Walking 与 Racing 必须能从抽中的边缘直接到场并停在基准帧",
      );
      cursor += 1;
    }

    const assertActionBlock = (expectedActions, expectedMediaClass) => {
      assert(
        expectedActions.length >= 1 &&
          expectedActions.length <= 3 &&
          expectedActions.every(
            (action, index) =>
              index === 0 || action !== expectedActions[index - 1],
          ),
        "每个 passage 动作块必须包含一至三个不相邻重复的动作",
      );
      expectedActions.forEach((action) => {
        const step = steps[cursor];
        assert(
          step.kind === "action" &&
            step.scene === action &&
            step.motionClass === "clawd-scene-motion--anchored" &&
            step.mediaClass === expectedMediaClass &&
            step.durationMs === actionDurations[action] &&
            step.exitOffscreen === false &&
            step.restartOffscreen === false,
          "每次到场或 bridge 入场后必须立即接有效的锚定动作块",
        );
        cursor += 1;
      });
    };

    assert(
      journey.actionBlocks.length === journey.bridgeCount + 1 &&
        journey.bridgeModes.length === journey.bridgeCount &&
        journey.bridgeModes.every(
          (mode) => mode === "walking" || mode === "racing",
        ) &&
        journey.actionNames.join(",") === journey.actionBlocks.flat().join(","),
      "每个到场段和 bridge 段必须各自记录一个动作块",
    );
    assertActionBlock(journey.actionBlocks[0], entryMediaClass);

    journey.bridgeModes.forEach((bridgeMode, bridgeIndex) => {
      const bridgeExit = steps[cursor];
      const bridgeEnter = steps[cursor + 1];
      const bridgeExitEdge = routeEdge(bridgeExit);
      const bridgeEntryEdge = oppositeEdge(bridgeExitEdge);
      const bridgeMediaClass = travelMediaClass(bridgeExitEdge, false);
      assert(
        bridgeExit.kind === "bridge-exit" &&
          bridgeExit.scene === bridgeMode &&
          bridgeExit.durationMs === travelDuration(bridgeMode) &&
          bridgeExit.motionClass ===
            travelMotionClass(bridgeMode, "exit", bridgeExitEdge, true) &&
          bridgeExit.mediaClass === bridgeMediaClass &&
          bridgeExit.exitOffscreen === true &&
          bridgeExit.restartOffscreen === false &&
          bridgeEnter.kind === "bridge-enter" &&
          bridgeEnter.scene === bridgeMode &&
          bridgeEnter.durationMs === travelDuration(bridgeMode) &&
          routeEdge(bridgeEnter) === bridgeEntryEdge &&
          bridgeEnter.motionClass ===
            travelMotionClass(bridgeMode, "enter", bridgeEntryEdge) &&
          bridgeEnter.positionStyle === bridgeExit.positionStyle &&
          bridgeEnter.mediaClass === bridgeExit.mediaClass &&
          bridgeEnter.exitOffscreen === false &&
          bridgeEnter.restartOffscreen === true,
        "bridge 必须完全离屏后立刻由对侧以同模式、同朝向和同高度重入",
      );
      cursor += 2;
      assertActionBlock(
        journey.actionBlocks[bridgeIndex + 1],
        bridgeEnter.mediaClass,
      );
    });

    if (steps[cursor].kind === "farewell") {
      const farewell = steps[cursor];
      assert(
        journey.actionNames[journey.actionNames.length - 1] !== "waving" &&
          farewell.scene === "waving" &&
          farewell.motionClass === "clawd-scene-motion--anchored" &&
          farewell.durationMs === scheduler.CLAWD_WAVING_DURATION_MS &&
          farewell.mediaClass === travelMediaClass(journey.exitEdge, false) &&
          farewell.exitOffscreen === false &&
          farewell.restartOffscreen === false,
        "告别挥手只允许出现在所有 bridge 与动作块之后、最终离场之前",
      );
      cursor += 1;
    }

    if (journey.departureMode === "rowing") {
      const intro = steps[cursor];
      const rowingExit = steps[cursor + 1];
      assert(
        intro.kind === "rowing-intro" &&
          intro.scene === "rowing-intro" &&
          intro.motionClass === "clawd-scene-motion--anchored" &&
          intro.durationMs === scheduler.CLAWD_ROWING_INTRO_DURATION_MS &&
          intro.mediaClass === travelMediaClass(journey.exitEdge, false) &&
          intro.exitOffscreen === false &&
          intro.restartOffscreen === false &&
          rowingExit === last &&
          rowingExit.kind === "exit" &&
          rowingExit.scene === "rowing" &&
          rowingExit.motionClass ===
            `clawd-scene-motion--row-exit-${journey.exitEdge}` &&
          rowingExit.durationMs === scheduler.CLAWD_ROWING_DURATION_MS &&
          rowingExit.mediaClass === intro.mediaClass &&
          rowingExit.exitOffscreen === true &&
          rowingExit.restartOffscreen === false,
        "划船必须以静止 intro 无闪交接同方向 rowing，并作为 terminal departure",
      );
      cursor += 2;
    } else {
      const departure = steps[cursor];
      assert(
        !steps.some((step) => step.kind === "rowing-intro") &&
          departure === last &&
          departure.kind === "exit" &&
          departure.scene === journey.departureMode &&
          departure.motionClass ===
            travelMotionClass(
              journey.departureMode,
              "exit",
              journey.exitEdge,
            ) &&
          departure.durationMs === travelDuration(journey.departureMode) &&
          departure.mediaClass === travelMediaClass(journey.exitEdge, false) &&
          departure.exitOffscreen === true &&
          departure.restartOffscreen === false,
        "Walking 与 Racing final departure 必须从抽中的边缘完整离屏",
      );
      cursor += 1;
    }

    assert(
      cursor === steps.length &&
        first.positionStyle === positionStyle &&
        last.kind === "exit" &&
        last.exitOffscreen === true &&
        last.motionClass.endsWith(`-${journey.exitEdge}`) &&
        steps.every(
          (step, index) =>
            Boolean(step.scene) &&
            Boolean(scheduler.CLAWD_SCENE_SOURCES[step.scene]) &&
            step.durationMs > 0 &&
            step.positionStyle === positionStyle &&
            (step.restartOffscreen === false ||
              (step.kind === "bridge-enter" &&
                index > 0 &&
                steps[index - 1].kind === "bridge-exit" &&
                steps[index - 1].exitOffscreen === true &&
                steps[index - 1].scene === step.scene &&
                steps[index - 1].positionStyle === step.positionStyle)),
        ),
      "passage 不得含空白或内部静默，且 restart 只能紧跟同源同高度的离屏 bridge",
    );
  });
  assert(
    scheduler.CLAWD_ACTION_BLOCK_SIZES.join(",") === "1,1,2,2,3" &&
      scheduler.CLAWD_WEIGHTED_ARRIVALS.join(",") ===
        "lurking,walking,walking,racing,rowing" &&
      scheduler.CLAWD_BRIDGE_COUNTS.join(",") === "0,0,1,1,2" &&
      scheduler.CLAWD_WEIGHTED_BRIDGE_MODES.join(",") ===
        "walking,walking,racing,racing" &&
      scheduler.CLAWD_BASELINE_HANDOFF_MS === 80 &&
      scheduler.CLAWD_WALKING_SOURCE_DURATION_MS === 1860 &&
      scheduler.CLAWD_WALKING_DURATION_MS === 1940 &&
      scheduler.CLAWD_LURKING_DURATION_MS === 5580 &&
      scheduler.CLAWD_WAVING_DURATION_MS === 1490 &&
      scheduler.CLAWD_JUMPING_DURATION_MS === 1840 &&
      scheduler.CLAWD_DANCING_DURATION_MS === 3410 &&
      scheduler.CLAWD_LAPTOP_DURATION_MS === 3660 &&
      scheduler.CLAWD_MAGNIFIER_DURATION_MS === 9490 &&
      scheduler.CLAWD_RACING_DURATION_MS === 4090 &&
      scheduler.CLAWD_ROWING_INTRO_DURATION_MS === 2170 &&
      scheduler.CLAWD_ROWING_OUTRO_DURATION_MS === 2170 &&
      scheduler.CLAWD_ROWING_DURATION_MS === 1840 &&
      scheduler.randomIntegerInclusive(
        scheduler.CLAWD_QUIET_RANGE_MS,
        () => 0,
      ) === 900 &&
      scheduler.randomIntegerInclusive(
        scheduler.CLAWD_QUIET_RANGE_MS,
        () => 0.999999,
      ) === 2800,
    "小克源时长、80ms 基准帧留白和 900–2800ms 静默区间必须精确",
  );
}
assert(
  timetablePageStyles.includes(".theme-swatch--default") &&
    timetablePageStyles.includes(".theme-swatch--snack") &&
    timetablePageStyles.includes(".theme-swatch--vivid") &&
    !timetablePageTemplate.includes('class="theme-check"') &&
    timetablePageStyles.includes("0 0 0 5rpx") &&
    /linear-gradient\(\s*137deg/.test(timetablePageStyles) &&
    /linear-gradient\(\s*126deg/.test(timetablePageStyles) &&
    timetablePageTemplate.includes("theme-swatch-mix--snack-mint") &&
    timetablePageTemplate.includes("theme-swatch-mix--snack-rose") &&
    timetablePageTemplate.includes("theme-swatch-mix--snack-lilac") &&
    timetablePageTemplate.includes("theme-swatch-mix--vivid-purple") &&
    timetablePageTemplate.includes("theme-swatch-mix--vivid-amber") &&
    timetablePageTemplate.includes("theme-swatch-mix--vivid-sky") &&
    timetablePageStyles.includes("filter: blur(6rpx)") &&
    /\.timetable-theme--snack \.grid-course,\s*\.timetable-theme--vivid \.grid-course\s*\{[^}]*border:\s*0;/s.test(
      timetablePageStyles,
    ),
  "主题色球必须使用外环选中态，并区分交融的低饱和与明亮高饱和配色",
);
assert(
  timetablePageScript.includes("MENU_TRANSITION_MS = 220") &&
    timetablePageScript.includes("menuMounted: false") &&
    timetablePageScript.includes("openTimetableMenu()") &&
    timetablePageScript.includes("closeTimetableMenu()") &&
    timetablePageTemplate.includes('wx:if="{{menuMounted}}"') &&
    timetablePageTemplate.includes("timetable-menu--open") &&
    timetablePageStyles.includes(".timetable-menu--open") &&
    /\.timetable-menu\s*\{[^}]*background:\s*#fff;[^}]*opacity:\s*0;[^}]*transform:\s*translateY\(-8rpx\);[^}]*transition:/s.test(
      timetablePageStyles,
    ) &&
    !/\.timetable-menu\s*\{[^}]*backdrop-filter:/s.test(
      timetablePageStyles,
    ),
  "课表菜单必须使用不透明实体表面，并以轻量过渡平滑完成进入与收回",
);
assert(
  dayColumnRule && !dayColumnRule.includes("border"),
  "课表背景不应保留纵向浅色网格",
);
assert(
  periodLineRule && !periodLineRule.includes("border"),
  "课表背景不应保留横向浅色网格",
);
assert(
  timetablePageTemplate.includes('class="month-number tnum"') &&
    timetablePageTemplate.includes('class="month-unit"'),
  "月份数字和‘月’必须分成两行并分别对齐星期与日期",
);
assert(
  timetablePageTemplate.includes('bindtap="toggleWeekMenu"') &&
    timetablePageTemplate.includes('bindtap="selectWeek"'),
  "顶部周次必须提供可直接切换周次的弹出菜单",
);
assert(
  timetablePageTemplate.includes(
    '<view class="week-option-number tnum">{{week.weekNumber}}</view>',
  ) &&
    timetablePageTemplate.includes(
      '<view class="week-option-date tnum">{{week.startDateLabel}}</view>',
    ) &&
    !timetablePageTemplate.includes('class="week-option-content"'),
  "周次数字和日期必须作为胶囊内的两个直接块级节点纵向排列",
);
assert(
  timetablePageTemplate.includes('wx:for="{{weekMenuRows}}"') &&
    timetablePageTemplate.includes('id="{{weekRow.id}}"') &&
    !timetablePageTemplate.includes('class="week-options"') &&
    timetablePageScript.includes("function timetableWeekMenuRows(") &&
    timetablePageScript.includes("weekMenuRowId(this.data.weekNumber)") &&
    /\.week-option-row\s*\{[^}]*flex:\s*none[^}]*height:\s*86rpx/s.test(
      timetablePageStyles,
    ),
  "Skyline 周次选择器必须使用独立轻量数据和可直接虚拟化的固定高度行",
);
assert(
  /\.week-option-date\s*\{[^}]*display:\s*block[^}]*height:\s*22rpx[^}]*font-size:\s*17rpx[^}]*line-height:\s*22rpx[^}]*text-align:\s*center/s.test(
    timetablePageStyles,
  ),
  "周次日期必须使用 Skyline 可稳定渲染的显式块级高度与行高",
);
assert(
  /\.period-time\s*\{[^}]*margin-top:\s*5rpx[^}]*font-size:\s*16rpx/s.test(
    timetablePageStyles,
  ),
  "左侧节次时间必须保持清晰字号，并与节次数字留出间距",
);
assert(
  timetablePageTemplate.includes("padding-top: {{course.topInsetPx}}px;"),
  "课程块必须应用按屏幕行高计算的顶部对齐距离",
);
assert(
  timetablePageTemplate.includes("week-option--current") &&
    /\.week-option\s*\{[^}]*border-radius:\s*999rpx/s.test(
      timetablePageStyles,
    ) &&
    /\.week-option--current\s*\{[^}]*border-color:\s*#0862ad/s.test(
      timetablePageStyles,
    ),
  "周次选项必须使用胶囊形，并持续描边标识当前周",
);
assert(
  timetablePageScript.includes("timetableRequestsInFlight") &&
    timetablePageScript.includes("refresh || !semester") &&
    timetablePageScript.includes("result.meta.stale === true"),
  "静默刷新必须允许其他学期请求、识别旧服务端快照并保留当前周",
);
assert(
  appSource.includes("prewarmTimetableFirstScreen(account, timetable)") &&
    timetableStoreSource.includes(
      "prewarmTimetableFirstScreen(account, snapshot)",
    ) &&
    timetablePageScript.includes("getPrewarmedTimetableFirstScreen") &&
    timetablePageScript.includes("queueRemainingWeekPages") &&
    timetablePageTemplate.includes('wx:if="{{weekPage.ready}}"') &&
    !timetablePageTemplate.includes('class="week-page page-enter"') &&
    timetableRenderSource.includes("buildTimetableWeekPlaceholder"),
  "应用启动时必须只预渲染首屏周次，进入课表后再静默补齐其他周",
);
assert(
  timetableStoreSource.includes(
    "weekDates: buildTimetableWeekDateCache(cachedData)",
  ) &&
    timetableStoreSource.includes("SEMESTER_CATALOG_PREFIX") &&
    timetableStoreSource.includes("mergeTimetableSemesterCatalog"),
  "每个课表快照都必须在本地持久化周次日期和完整学期目录",
);
assert(
  timetablePageTemplate.includes("menu-glyph--open") &&
    timetablePageStyles.includes(".menu-glyph--open > view:nth-child(1)"),
  "课表菜单按钮必须在三横线和关闭图标之间平滑变形",
);
assert(
  timetablePageTemplate.includes(
    '<bottom-sheet visible="{{courseSheetVisible}}" expanded="{{true}}" scrollable="{{false}}"',
  ) &&
    timetablePageTemplate.includes('expanded-height="{{courseSheetHeight}}"') &&
    !timetablePageTemplate.includes("用户所在时区") &&
    timetablePageScript.includes("function courseSheetHeight(") &&
    timetablePageScript.includes("const detailValues = [") &&
    timetablePageScript.includes(
      "courseSheetHeight: courseSheetHeight(course)",
    ) &&
    timetablePageScript.includes("function viewportSheetHeight(") &&
    timetablePageScript.includes("contentHeightRpx,\n    44,\n    82,") &&
    bottomSheetScript.includes("expandedHeight: { type: Number, value: 86 }") &&
    bottomSheetTemplate.includes("'height:' + expandedHeight + 'vh;'") &&
    timetablePageTemplate.includes('bindtap="openCoursePassRate"') &&
    timetablePageTemplate.includes("查看通过率") &&
    timetablePageTemplate.includes(
      '<lucide-icon name="chevron-right" tone="white" size="{{28}}"',
    ) &&
    /\.course-sheet-hero-main\s*\{[^}]*align-items:\s*center/s.test(
      timetablePageStyles,
    ) &&
    /\.course-pass-rate-action\s*\{[^}]*align-self:\s*center[^}]*min-height:\s*64rpx[^}]*font-size:\s*22rpx/s.test(
      timetablePageStyles,
    ) &&
    timetablePageTemplate.includes(
      '<bottom-sheet visible="{{passRateSheetVisible}}" expanded="{{true}}"',
    ) &&
    timetablePageTemplate.includes(
      'expanded-height="{{passRateSheetHeight}}"',
    ) &&
    timetablePageScript.includes("function passRateSheetHeight(") &&
    timetablePageScript.includes('input.status === "ready"') &&
    timetablePageScript.includes(
      "passRateSheetHeight: passRateSheetHeight({",
    ) &&
    timetablePageTemplate.includes("<pass-rate-card") &&
    passRatePageTemplate.includes("<pass-rate-card") &&
    passRateCardTemplate.includes('id="pass-rate-ring-canvas"') &&
    timetablePageScript.includes("courseStatisticsKey(selectedCourse.name)") &&
    timetablePageScript.includes("await getPassRates(courseKey)"),
  "课程详情必须直接展开，并从课程卡片打开复用的当前课程通过率统计卡片",
);
assert(
  timetablePageTemplate.includes("refresh-confirmation--visible") &&
    /},\s*3000\);/.test(timetablePageScript) &&
    timetablePageScript.includes("const succeeded = await this.loadTimetable"),
  "手动刷新成功后必须显示三秒的非阻塞完成反馈",
);

console.log("Timetable preview checks passed.");
