const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(
  path.resolve(__dirname, "../miniprogram/data/custom-courses.ts"),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const moduleRecord = { exports: {} };
new Function("module", "exports", compiled)(moduleRecord, moduleRecord.exports);
const { withCustomCourses } = moduleRecord.exports;
const timetableSource = fs.readFileSync(path.resolve(__dirname, "../miniprogram/data/timetable.ts"), "utf8");
const timetableModule = { exports: {} };
new Function("module", "exports", ts.transpileModule(timetableSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(timetableModule, timetableModule.exports);

const timetable = {
  semester: { id: "term-1" },
  periods: [1, 2, 3, 4].map((period) => ({
    period,
    startTime: `${String(period + 7).padStart(2, "0")}:00`,
    endTime: `${String(period + 7).padStart(2, "0")}:45`,
  })),
  courses: [{ id: "school-course" }],
};
const course = {
  id: "custom-1",
  semesterId: "term-1",
  name: "实验课",
  location: "",
  teacher: "",
  weekday: 2,
  periods: [1, 2, 4],
  weeks: [3, 5],
};
const result = withCustomCourses(timetable, [course]);
assert.equal(result.courses.length, 2);
assert.equal(
  timetable.courses.length,
  1,
  "school snapshot must remain untouched",
);
const custom = result.courses[1];
assert.equal(custom.userAdded, true);
assert.deepEqual(
  custom.arrangements.map((item) => item.periods),
  [[1, 2], [4]],
  "nonadjacent periods must not fill the gap",
);
assert.deepEqual(
  custom.arrangements.map((item) => item.weeks),
  [
    [3, 5],
    [3, 5],
  ],
);
assert.equal(custom.arrangements[0].location.display, "");
assert.deepEqual(custom.arrangements[0].teacherNames, []);
const multipleDays = withCustomCourses(timetable, [{ ...course, weekdays: [2, 4] }]).courses[1];
assert.deepEqual(multipleDays.arrangements.map((item) => item.weekday), [2, 2, 4, 4]);
assert.equal(new Set(multipleDays.arrangements.map((item) => item.id)).size, 4);
assert.equal(
  withCustomCourses(timetable, [{ ...course, semesterId: "term-2" }]),
  timetable,
);
const datedTimetable = { ...timetable, courses: [], semesterCalendar: {
  semesterId: "term-1",
  weeks: [
    { weekNumber: 3, startDate: "2026-08-24", endDate: "2026-08-30" },
    { weekNumber: 5, startDate: "2026-09-07", endDate: "2026-09-13" },
  ],
} };
const hydrated = withCustomCourses(datedTimetable, [course]);
const initialWeek = timetableModule.exports.coursesForWeek(hydrated, 3);
assert.equal(initialWeek.length, 2);
const excludedDate = initialWeek[0].date;
assert.ok(excludedDate, "course occurrence should have a local date");
const excluded = withCustomCourses(hydrated, [{ ...course, excludedDates: [excludedDate] }]);
assert.equal(timetableModule.exports.coursesForWeek(excluded, 3).length, 0, "one deleted date removes every period block on that date");
assert.equal(timetableModule.exports.coursesForWeek(excluded, 5).length, 2, "other weeks remain visible");
assert.equal(withCustomCourses(excluded, []).courses.length, 0, "deleting all removes the old custom course");
console.log(
  "Custom course semester, period, and optional field checks passed.",
);
