const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "utils", "grades.ts"),
  "utf8",
);
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

const {
  gradeComponentWidths,
  gradePointRingValue,
  latestGradedSemester,
  latestSemesterGrades,
} = moduleRecord.exports;

const latestCourses = [
  {
    id: "latest-required",
    academicYear: "2025-2026",
    term: 2,
    credits: 4,
    finalScore: 90,
    calculationScore: 90,
    gradePoint: 4.3,
    countsTowardGradePointAverage: true,
  },
  {
    id: "latest-elective",
    academicYear: "2025-2026",
    term: 2,
    credits: 2,
    finalScore: 80,
    calculationScore: 80,
    gradePoint: 3,
    countsTowardGradePointAverage: false,
  },
];
const data = {
  items: [
    {
      id: "newer-empty",
      academicYear: "2026-2027",
      term: 1,
      credits: 2,
      finalScore: null,
      calculationScore: null,
      gradePoint: null,
      countsTowardGradePointAverage: true,
    },
    ...latestCourses,
    {
      id: "older",
      academicYear: "2024-2025",
      term: 2,
      credits: 3,
      finalScore: 70,
      calculationScore: 70,
      gradePoint: 2,
      countsTowardGradePointAverage: true,
    },
  ],
  pagination: { page: 1, pageSize: 200, total: 4, totalPages: 1 },
  summary: {
    courseCount: 4,
    totalCredits: 11,
    weightedAverage: 80.91,
    gradePointAverage: 3.31,
  },
  semesters: [
    {
      id: "2026-1",
      academicYear: 2026,
      academicYearLabel: "2026-2027",
      term: 1,
      label: "2026-2027 · 第一学期",
    },
    {
      id: "2025-2",
      academicYear: 2025,
      academicYearLabel: "2025-2026",
      term: 2,
      label: "2025-2026 · 第二学期",
    },
    {
      id: "2024-2",
      academicYear: 2024,
      academicYearLabel: "2024-2025",
      term: 2,
      label: "2024-2025 · 第二学期",
    },
  ],
};

assert(
  latestGradedSemester(data).id === "2025-2",
  "默认学期必须跳过尚无成绩的更新学期",
);
const latest = latestSemesterGrades(data);
assert(
  latest.items.map((course) => course.id).join(",") ===
    "latest-required,latest-elective",
  "首页预览与成绩页默认视图只能包含最新有成绩学期",
);
assert(
  latest.summary.courseCount === 2 &&
    latest.summary.totalCredits === 6 &&
    latest.summary.weightedAverage === 86.67 &&
    latest.summary.gradePointAverage === 4.3,
  "最新学期的均分、绩点、课程与学分必须独立汇总",
);
assert(
  gradePointRingValue(4) === 80 && gradePointRingValue(5) === 100,
  "首页绩点圆环必须以 5.0 为满环",
);
assert(
  gradeComponentWidths([{ weightPercent: 30 }, { weightPercent: 70 }]).join(
    ",",
  ) === "30,70" &&
    gradeComponentWidths([{ weightPercent: 30 }, { weightPercent: null }]).join(
      ",",
    ) === "30,70" &&
    gradeComponentWidths([{ weightPercent: 100 }, { weightPercent: 0 }]).join(
      ",",
    ) === "100,0",
  "成绩组成线段必须按真实占比绘制并保留零占比",
);

const fiveLevelSummary = latestSemesterGrades({
  ...data,
  items: [
    {
      ...latestCourses[0],
      id: "level-a",
      finalScore: "A",
      calculationScore: 95,
      gradePoint: 4.6,
      credits: 1,
    },
    {
      ...latestCourses[0],
      id: "level-e",
      finalScore: "不及格",
      calculationScore: 55,
      gradePoint: 0,
      credits: 1,
    },
  ],
  pagination: { page: 1, pageSize: 200, total: 2, totalPages: 1 },
}).summary;
assert(
  fiveLevelSummary.weightedAverage === 75 &&
    fiveLevelSummary.gradePointAverage === 2.3,
  "五级制换算后的分数和零绩点课程必须按学分进入最新学期汇总",
);

const gradesPageScript = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "pages", "grades", "index.ts"),
  "utf8",
);
const gradesPageTemplate = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "pages", "grades", "index.wxml"),
  "utf8",
);
const teachingService = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "services", "teaching.ts"),
  "utf8",
);
assert(
  gradesPageScript.includes("displayScore: formatScore(course.finalScore)") &&
    !gradesPageScript.includes("formatScore(course.calculationScore)") &&
    gradesPageTemplate.includes("{{item.displayScore}}") &&
    !gradesPageTemplate.includes("calculationScore"),
  "五级制课程必须显示教务原始等级，换算分数只能参与内部计算",
);
assert(
  teachingService.includes(
    'sort: query.sort === "default" ? undefined : query.sort',
  ),
  "默认成绩排序不得显式发送 sort=default，以兼容尚未重启的旧服务进程",
);
assert(
  gradesPageScript.includes("displayScore: formatScore(course.finalScore)") &&
    fs
      .readFileSync(
        path.resolve(
          __dirname,
          "..",
          "miniprogram",
          "pages",
          "grade-detail",
          "index.ts",
        ),
        "utf8",
      )
      .includes('{ label: "教师", value: course.teacherName || "—" }'),
  "课程成绩详情必须显示成绩接口返回的教师原文",
);

console.log("Grade preview checks passed.");
