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
  "应根据教务系统学期起止日期计算教学周",
);
assert(
  timetable.coursePreview(null, duringFirstCourse).courses.length === 0,
  "没有真实课表时不得回退到占位课程",
);

console.log("Timetable preview checks passed.");
