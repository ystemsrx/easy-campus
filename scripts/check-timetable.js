const fs = require("node:fs");
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const timetable = loadTimetable();

const duringFirstCourse = new Date(2026, 7, 10, 8, 30);
const currentAndNext = timetable.coursePreview(duringFirstCourse);
assert(currentAndNext.courses.length === 3, "进行中时应预览三节课");
assert(
  currentAndNext.currentCourseId === "mon-data-structure",
  "第一节进行中时应将它置于首位",
);
assert(
  currentAndNext.courses[1].id === "mon-college-english" &&
    currentAndNext.courses[2].id === "mon-database",
  "进行中课程后应紧跟当天后两节课",
);

const betweenCourses = new Date(2026, 7, 10, 9, 50);
const nextThree = timetable.coursePreview(betweenCourses);
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
const afterFirstCourse = timetable.coursePreview(atCourseEnd);
assert(
  afterFirstCourse.currentCourseId === null &&
    afterFirstCourse.courses[0].id === "mon-college-english",
  "到达下课时刻后不应继续显示上一节为进行中",
);

const afterClasses = new Date(2026, 7, 10, 22, 0);
assert(
  timetable.coursePreview(afterClasses).courses.length === 0,
  "当天课程结束后不应保留预览课程",
);

console.log("Timetable preview checks passed.");
