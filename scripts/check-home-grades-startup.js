const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../miniprogram");
const compiled = new Map();

function bootHome(values, account = "student") {
  const modules = new Map();
  const app = { globalData: { session: null, preferences: null } };
  const wx = {
    getStorageSync: (key) => structuredClone(values.get(key)),
    setStorageSync: (key, value) => values.set(key, structuredClone(value)),
    removeStorageSync: (key) => values.delete(key),
    getAppBaseInfo: () => ({ theme: "light" }),
    getWindowInfo: () => ({ windowWidth: 375 }),
    setBackgroundColor: () => {},
    nextTick: (callback) => callback(),
  };
  let page;
  const overrides = new Map([
    [
      "store/timetable.ts",
      {
        loadTimetableSnapshot: () => null,
        getTimetableRevision: () => 0,
      },
    ],
    [
      "utils/navigation.ts",
      {
        registerHomeAuthenticationHost: () => {},
        ensureAuthenticated: () => Boolean(app.globalData.session),
      },
    ],
  ]);
  function load(relative) {
    const filename = path.resolve(root, relative);
    const key = path.relative(root, filename).replace(/\\/g, "/");
    if (overrides.has(key)) return overrides.get(key);
    // Startup must succeed without accessing any network service.
    if (key.startsWith("services/")) {
      return new Proxy(
        {},
        {
          get: (_, name) => () => {
            throw new Error(
              `Unexpected startup request: ${key}:${String(name)}`,
            );
          },
        },
      );
    }
    if (modules.has(key)) return modules.get(key).exports;
    if (!compiled.has(key)) {
      compiled.set(
        key,
        ts.transpileModule(fs.readFileSync(filename, "utf8"), {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
          },
        }).outputText,
      );
    }
    const module = { exports: {} };
    modules.set(key, module);
    new Function(
      "module",
      "exports",
      "require",
      "wx",
      "getApp",
      "Page",
      compiled.get(key),
    )(
      module,
      module.exports,
      (request) => load(path.resolve(path.dirname(filename), `${request}.ts`)),
      wx,
      () => app,
      (definition) => {
        page = definition;
      },
    );
    return module.exports;
  }
  const preferences = load("store/preferences.ts");
  app.globalData.preferences = preferences.loadPreferences();
  const session = load("store/session.ts");
  function signIn(nextAccount) {
    session.saveSession({
      token: `test-${nextAccount}`,
      tokenType: "Bearer",
      sliding: true,
      user: { id: nextAccount, account: nextAccount, name: "测试" },
    });
  }
  if (account) signIn(account);
  else session.clearSession();
  const grades = load("store/grades.ts");
  load("pages/home/index.ts");
  const initialData = structuredClone(page.data);
  page.setData = (patch, callback) => {
    Object.assign(page.data, structuredClone(patch));
    callback?.();
  };
  page.getTabBar = () => ({ setData: () => {} });
  return { page, initialData, grades, preferences, signIn };
}

const storedAt = "2026-08-01T00:00:00.000Z";
const updatedAt = "2026-09-07T00:00:00.000Z";
const gradeData = {
  items: [
    {
      id: "retake-old",
      courseName: "数学",
      credits: 2,
      finalScore: 60,
      calculationScore: 60,
      gradePoint: 1,
    },
    {
      id: "retake-new",
      courseName: "数学",
      credits: 2,
      finalScore: 90,
      calculationScore: 90,
      gradePoint: 4,
    },
    {
      id: "english",
      courseName: "英语",
      credits: 2,
      finalScore: 80,
      calculationScore: 80,
      gradePoint: 3,
    },
    {
      id: "failed",
      courseName: "物理",
      credits: 2,
      finalScore: 50,
      calculationScore: 50,
      gradePoint: 0,
    },
  ],
  semesters: [],
  pagination: { page: 1, pageSize: 5000, total: 4, totalPages: 1 },
  summary: {
    courseCount: 4,
    totalCredits: 8,
    weightedAverage: 70,
    gradePointAverage: 2,
  },
};
const emptyGrades = {
  items: [],
  semesters: [],
  pagination: { page: 1, pageSize: 5000, total: 0, totalPages: 0 },
  summary: {
    courseCount: 0,
    totalCredits: 0,
    weightedAverage: null,
    gradePointAverage: null,
  },
};
const values = new Map();
bootHome(values).grades.saveGradesSnapshot("student", gradeData, storedAt);

// A new module/page instance reads the persisted cache before lifecycle callbacks.
const cached = bootHome(values);
assert.equal(
  cached.initialData.gradeAverageLabel,
  "73.3",
  "cached average must be present in Page.data before onLoad",
);
assert.equal(cached.initialData.gradePointAverageLabel, "2.33");
assert.equal(
  cached.initialData.gradeCourseCount,
  3,
  "retakes count once in the startup preview",
);
cached.page.onLoad();
cached.page.onShow();
assert.equal(cached.page.data.gradeAverageLabel, "73.3");
assert.equal(cached.page.data.gradePointAverageLabel, "2.33");

cached.page.hydrateServerGrade(
  "student",
  {
    data: emptyGrades,
    meta: { cached: true, fetchedAt: storedAt },
  },
  false,
  true,
);
assert.equal(
  cached.page.data.gradeAverageLabel,
  "73.3",
  "equal server timestamps retain cached numbers",
);
cached.page.hydrateServerGrade(
  "student",
  {
    data: emptyGrades,
    meta: { cached: true, stale: true, fetchedAt: updatedAt },
  },
  true,
  true,
);
assert.equal(
  cached.page.data.gradeAverageLabel,
  "73.3",
  "failed refresh fallback must not clear the preview",
);

const filteredValues = new Map(values);
cached.preferences.updatePreferences({
  showGradesBelow60: false,
  showGradesOnHome: false,
  reducedMotion: true,
});
const filtered = bootHome(values);
assert.equal(filtered.initialData.gradeAverageLabel, "85");
assert.equal(filtered.initialData.gradePointAverageLabel, "3.50");
assert.equal(filtered.initialData.gradeCourseCount, 2);
assert.equal(filtered.initialData.showGradesOnHome, false);
assert.ok(
  !decodeURIComponent(filtered.initialData.gradeRingSource).includes(
    "<animate",
  ),
);

for (const account of ["uncached", ""]) {
  const empty = bootHome(new Map(values), account);
  assert.equal(empty.initialData.gradeAverageLabel, "—");
  assert.equal(empty.initialData.gradePointAverageLabel, "—");
  assert.equal(empty.initialData.gradeCourseCount, 0);
}

const switched = bootHome(filteredValues);
switched.page.onLoad();
switched.signIn("uncached");
switched.page.onShow();
assert.equal(
  switched.page.data.gradeAverageLabel,
  "—",
  "switching to an uncached account must clear the previous grade preview",
);
assert.equal(switched.page.data.gradePointAverageLabel, "—");
assert.equal(switched.page.data.gradeCourseCount, 0);

const deleted = bootHome(new Map(filteredValues));
deleted.page.onLoad();
deleted.page.onShow();
deleted.page.hydrateServerGrade(
  "student",
  {
    data: emptyGrades,
    meta: { cached: true, deleted: true, fetchedAt: updatedAt },
  },
  false,
  true,
);
assert.equal(
  deleted.page.data.gradeAverageLabel,
  "—",
  "a newer server deletion must clear the preview",
);
const deletedValues = new Map();
bootHome(deletedValues).grades.saveGradesSnapshot(
  "student",
  emptyGrades,
  updatedAt,
  true,
  true,
);
const deletedStartup = bootHome(deletedValues);
assert.equal(deletedStartup.initialData.gradeAverageLabel, "—");
assert.equal(deletedStartup.initialData.gradeCourseCount, 0);

console.log("Home grade startup checks passed.");
