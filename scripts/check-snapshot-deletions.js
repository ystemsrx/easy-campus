const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const values = new Map();
const wx = {
  getStorageSync: (key) => values.get(key),
  setStorageSync: (key, value) => values.set(key, structuredClone(value)),
  removeStorageSync: (key) => values.delete(key),
};
function load(relative, dependencies = {}) {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../miniprogram", relative),
    "utf8",
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", "wx", code)(
    module,
    module.exports,
    (name) => {
      assert.ok(
        Object.hasOwn(dependencies, name),
        `Unexpected dependency: ${name}`,
      );
      return dependencies[name];
    },
    wx,
  );
  return module.exports;
}
const policy = load("store/cache-policy.ts");
const grades = load("store/grades.ts", { "../utils/grades": {} });
const exams = load("store/exams.ts");
const timetable = load("store/timetable.ts", {
  "../data/timetable": { buildTimetableWeekDateCache: () => [] },
  "../data/timetable-render": { prewarmTimetableFirstScreen: () => undefined },
  "../data/timetable-theme": { loadTimetableThemeId: () => "test" },
});
const old = "2026-09-01T00:00:00.000Z";
const deletedAt = "2026-09-06T00:00:00.000Z";
const newAt = "2026-09-07T00:00:00.000Z";
const meta = { cached: true, deleted: true, fetchedAt: deletedAt };
const pagination = { page: 1, pageSize: 20, total: 0, totalPages: 0 };
const gradeData = {
  items: [],
  semesters: [],
  pagination,
  summary: {
    courseCount: 0,
    totalCredits: 0,
    weightedAverage: null,
    gradePointAverage: null,
  },
};
grades.saveGradesSnapshot("a", { ...gradeData, items: [{ id: "old" }] }, old);
assert.equal(
  policy.shouldStoreServerSnapshot(grades.loadGradesSnapshot("a"), meta, true),
  true,
);
grades.saveGradesSnapshot("a", gradeData, deletedAt, true, true);
const cleared = grades.loadGradesSnapshot("a");
assert.deepEqual(cleared.data.items, []);
assert.equal(cleared.deleted, true);
assert.equal(policy.isCacheStale(cleared, policy.FIFTEEN_DAYS_MS), true);
assert.equal(policy.isUpstreamRefreshResult(meta), false);
assert.equal(
  policy.shouldStoreServerSnapshot(cleared, { cached: false, fetchedAt: old }),
  false,
);
grades.saveGradesSnapshot("a", gradeData, newAt);
assert.equal(
  policy.shouldStoreServerSnapshot(grades.loadGradesSnapshot("a"), meta, true),
  false,
);

const semester = { id: "2025-2", academicYear: 2025, term: 2, label: "学期" };
const examData = {
  items: [{ id: "old" }],
  semesters: [semester],
  semester,
  pagination,
  summary: { total: 1 },
};
exams.saveExamsSnapshot("a", examData, {
  serverFetchedAt: old,
  lastAutomaticRefreshAt: 100,
});
exams.saveExamsSnapshot(
  "a",
  { ...examData, items: [] },
  { semesterId: semester.id, serverFetchedAt: deletedAt, deleted: true },
);
assert.deepEqual(exams.loadExamsSnapshot("a").data.items, []);
assert.equal(exams.loadExamsSnapshot("a").lastAutomaticRefreshAt, 0);

const timetableData = {
  semester,
  semesters: [semester],
  periods: [],
  courses: [{ id: "old" }],
};
timetable.saveTimetableSnapshot("a", timetableData, { serverFetchedAt: old });
timetable.saveTimetableSnapshot("a", timetableData, {
  semesterId: semester.id,
  serverFetchedAt: old,
});
timetable.saveTimetableSnapshot("b", timetableData, { serverFetchedAt: old });
timetable.saveTimetableSnapshot(
  "a",
  { ...timetableData, semesters: [], courses: [] },
  { semesterId: semester.id, serverFetchedAt: deletedAt, deleted: true },
);
assert.deepEqual(timetable.loadTimetableSnapshot("a").data.courses, []);
assert.equal(timetable.loadTimetableSnapshot("a").deleted, true);
assert.equal(timetable.loadTimetableSnapshot("b").data.courses.length, 1);
timetable.saveTimetableSnapshot("a", timetableData, {
  semesterId: semester.id,
  serverFetchedAt: newAt,
});
timetable.saveTimetableSnapshot(
  "a",
  { ...timetableData, semesters: [], courses: [] },
  { serverFetchedAt: deletedAt, deleted: true },
);
assert.equal(
  timetable.loadTimetableSnapshot("a", semester.id).data.courses.length,
  1,
  "older alias deletion cannot replace a newer semester snapshot",
);
const preview = load("store/teaching-preview.ts");
preview.saveTeachingPreview(
  "a",
  { messages: [{ id: "old" }] },
  { fetchedAt: old },
);
preview.saveTeachingPreview("a", { messages: [] }, meta);
preview.saveTeachingPreview(
  "a",
  { messages: [{ id: "delayed" }] },
  { fetchedAt: old },
);
assert.deepEqual(preview.loadTeachingPreview("a").messages, []);
preview.saveTeachingPreview(
  "a",
  { messages: [{ id: "new" }] },
  { fetchedAt: newAt },
);
preview.saveTeachingPreview("a", { messages: [] }, meta);
assert.equal(preview.loadTeachingPreview("a").messages[0].id, "new");

const schedule = load("store/schedule.ts");
schedule.storeScheduleData("a", {
  plans: [{ id: "old" }],
  clientUpdatedAt: old,
});
let uploads = 0;
const session = {
  user: { id: "1", account: "a" },
  token: "synthetic",
  signedInAt: 1,
};
const lease = { account: "a", userId: "1", token: "synthetic", signedInAt: 1 };
const preload = load("services/primary-tab-preload.ts", {
  "../demo/bootstrap": { prepareDemoData: () => false },
  "../data/schedule-render": {
    prewarmScheduleFirstScreen: () => ({}),
    prewarmSchedulePager: async () => undefined,
  },
  "../data/profile-render": { prewarmProfileFirstScreen: () => undefined },
  "../store/cache-policy": policy,
  "../store/schedule": schedule,
  "../store/session": {
    getSession: () => session,
    captureSessionLease: () => lease,
    isSessionLeaseCurrent: () => true,
    sessionLeaseKey: () => "synthetic",
  },
  "../store/timetable": timetable,
  "./auth": { getCurrentUser: async () => null },
  "./teaching": {
    getLocalSchedule: async () => ({
      data: { plans: [], clientUpdatedAt: null },
      meta,
    }),
    putLocalSchedule: async () => {
      uploads++;
      throw new Error("Old schedule must not be uploaded");
    },
    getTimetable: async () => ({
      data: { ...timetableData, semesters: [] },
      meta: { cached: true, fetchedAt: newAt },
    }),
  },
});
preload
  .getPreloadedSchedule()
  .then((result) => {
    assert.equal(uploads, 0);
    assert.deepEqual(result.plans, []);
    assert.deepEqual(schedule.loadScheduleData("a").plans, []);
    assert.equal(schedule.loadScheduleData("a").clientUpdatedAt, deletedAt);
    console.log("Snapshot deletion checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
