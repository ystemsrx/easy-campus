const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");

const scenarios = {
  "Asia/Shanghai": {
    schoolTimestamp: "8月13日 06:08",
    utcTimestamp: "8月13日 09:02",
    examDate: "1月12日 周一",
    examTime: "09:00",
    timetableDate: "2026-08-10",
    timetableTime: "08:00",
  },
  "America/New_York": {
    schoolTimestamp: "8月12日 18:08",
    utcTimestamp: "8月12日 21:02",
    examDate: "1月11日 周日",
    examTime: "20:00",
    timetableDate: "2026-08-09",
    timetableTime: "20:00",
  },
  "Europe/London": {
    schoolTimestamp: "8月12日 23:08",
    utcTimestamp: "8月13日 02:02",
    examDate: "1月12日 周一",
    examTime: "01:00",
    timetableDate: "2026-08-10",
    timetableTime: "01:00",
  },
};

function loadDateUtilities() {
  const sourcePath = path.resolve(__dirname, "..", "miniprogram", "utils", "date.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
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

function loadTimetableUtilities() {
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

function loadTimetableRender(timetable) {
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
      if (request === "./timetable") return timetable;
      return require(request);
    },
  );
  return moduleRecord.exports;
}

function timetableFixture() {
  const semester = {
    id: "2026-1",
    academicYear: 2026,
    academicYearLabel: "2026-2027",
    term: 1,
    label: "2026-2027 · 第一学期",
  };
  return {
    semester,
    semesters: [semester],
    currentSemester: {
      ...semester,
      startDate: "2026-08-10",
      endDate: "2026-11-29",
    },
    sourceTimeZone: "Asia/Shanghai",
    periods: [{ period: 1, startTime: "08:00", endTime: "08:45" }],
    courses: [
      {
        id: "course",
        courseCode: "COURSE",
        courseName: "课程",
        teachingClass: null,
        teacherNames: [],
        credits: null,
        category: null,
        nature: null,
        assessmentMethod: null,
        examMethod: null,
        teachingClassComposition: [],
        retake: false,
        selectionStatus: "selected",
        arrangements: [
          {
            id: "arrangement",
            weekday: 1,
            weekdayLabel: "星期一",
            periodStart: 1,
            periodEnd: 1,
            periods: [1],
            startTime: "08:00",
            endTime: "08:45",
            weekText: "1周",
            weeks: [1],
            activityType: "lecture",
            activityTypeLabel: "讲课",
            teacherNames: [],
            location: {
              campus: null,
              building: null,
              room: null,
              display: "地点待定",
            },
            teachingMethod: null,
            selectionStatus: "selected",
            adjusted: false,
          },
        ],
      },
    ],
    additionalCourses: [],
    summary: { courseCount: 1, arrangementCount: 1, maxWeek: 1 },
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

if (process.argv[2] === "child") {
  const expected = scenarios[process.env.TZ];
  const date = loadDateUtilities();
  const timetable = loadTimetableUtilities();
  const timetableRender = loadTimetableRender(timetable);
  assertEqual(
    date.formatDateTime("2026-08-13 06:08:54"),
    expected.schoolTimestamp,
    "plain school timestamp",
  );
  assertEqual(
    date.formatDateTime("2026-08-13T01:02:03.000Z"),
    expected.utcTimestamp,
    "UTC timestamp",
  );
  assertEqual(
    date.formatTimestampDate("2026-01-12T09:00:00+08:00"),
    expected.examDate,
    "exam date",
  );
  assertEqual(
    date.formatTimestampTime("2026-01-12T09:00:00+08:00"),
    expected.examTime,
    "exam time",
  );
  const localCourse = timetable.coursesForWeek(timetableFixture(), 1)[0];
  assertEqual(
    localCourse.date,
    expected.timetableDate,
    "timetable local date",
  );
  assertEqual(
    localCourse.startTime,
    expected.timetableTime,
    "timetable local time",
  );
  assertEqual(
    localCourse.sourceDate,
    "2026-08-10",
    "timetable campus date",
  );
  const weekPage = timetableRender.buildTimetableWeekPage(
    timetableFixture(),
    1,
    12,
    {
      rowHeightPx: 48,
      courseTopInsetPx: 2,
      courseHeightExtensionPx: 1,
      nameFontSizePx: 15,
      locationFontSizePx: 14,
      teacherFontSizePx: 12,
      contentWidthPx: 42,
      contentInsetPx: 8,
      scale: 1,
      viewportKey: "test",
    },
  );
  assertEqual(
    weekPage.gridDays.flatMap((day) => day.courses).length,
    1,
    "timetable course remains in campus week grid",
  );
  assertEqual(
    weekPage.gridDays[0].courses[0]?.id,
    "arrangement:w1",
    "timetable course uses campus occurrence date for its column",
  );
  process.exit(0);
}

for (const zone of Object.keys(scenarios)) {
  const result = spawnSync(process.execPath, [__filename, "child"], {
    env: { ...process.env, TZ: zone },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

console.log("User timezone conversion checks passed.");
