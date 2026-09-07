const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../miniprogram");
const modules = new Map();
const timers = [];
const revisions = { preferences: 0, session: 0, pet: 0, autoDormCheck: 0 };
let account = "account-a";
let systemTheme = "light";
let profileReads = 0;
let pagerBuilds = 0;
let definition;
const preferences = {
  theme: "system",
  visualTheme: "default",
  reducedMotion: false,
};
const app = { globalData: { user: null, preferences } };
const localSchedule = { plans: [], clientUpdatedAt: null };
const pet = {
  shape: "blob",
  color: "#111214",
  enhanced: false,
  selected: false,
  enabled: false,
};
const stubs = {
  "store/preferences": {
    loadPreferences: () => preferences,
    getPreferencesRevision: () => revisions.preferences,
  },
  "store/session": {
    getSession: () => ({ user: { account } }),
    getSessionRevision: () => revisions.session,
    loadCurrentUser: () => null,
  },
  "store/pet": {
    loadPetPreferences: () => {
      profileReads++;
      return pet;
    },
    getPetPreferencesRevision: () => revisions.pet,
    shouldShowPet: (value) => value.enabled,
  },
  "store/auto-dorm-check": {
    loadAutoDormCheckSnapshot: () => null,
    getAutoDormCheckRevision: () => revisions.autoDormCheck,
  },
  "store/schedule": {
    loadScheduleData: () => localSchedule,
    getScheduleRevision: () => 0,
  },
  "store/timetable": {
    loadTimetableSnapshot: () => null,
    getTimetableRevision: () => 0,
  },
  "services/auth": {},
  "services/auto-dorm-check": {},
  "services/feedback": {},
  "services/request": {},
  "services/primary-tab-preload": {},
  "services/teaching": {},
  "utils/haptics": {},
  "utils/navigation": {},
};

function load(relative) {
  const key = relative.replace(/\\/g, "/").replace(/\.ts$/, "");
  if (stubs[key]) return stubs[key];
  if (modules.has(key)) return modules.get(key).exports;
  const filename = path.join(root, key + ".ts");
  const record = { exports: {} };
  modules.set(key, record);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  new Function(
    "module",
    "exports",
    "require",
    "wx",
    "getApp",
    "Page",
    "setTimeout",
    code,
  )(
    record,
    record.exports,
    (id) => load(path.relative(root, path.resolve(path.dirname(filename), id))),
    { getAppBaseInfo: () => ({ theme: systemTheme }), setBackgroundColor() {} },
    () => app,
    (value) => {
      definition = value;
    },
    (callback) => timers.push(callback),
  );
  return record.exports;
}

function page(relative) {
  load(relative);
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch, callback) {
      Object.assign(this.data, patch);
      callback?.();
    },
  };
}

async function finishPreparation() {
  while (timers.length) {
    timers.shift()();
    await Promise.resolve();
  }
}

async function main() {
  const render = load("data/schedule-render");
  const now = new Date();
  const today = load("utils/date").toDateString(now);
  localSchedule.plans = [
    {
      id: "overnight",
      title: "跨日安排",
      date: today,
      startTime: "23:00",
      endDate: render.shiftScheduleDate(today, 1),
      endTime: "09:00",
      done: false,
    },
    {
      id: "next-week",
      title: "下周安排",
      date: render.shiftScheduleDate(today, 7),
      startTime: "10:00",
      endDate: render.shiftScheduleDate(today, 7),
      endTime: "11:00",
      done: true,
    },
  ];
  const firstScreen = render.prewarmScheduleFirstScreen(
    account,
    null,
    localSchedule,
    {},
    now,
  );
  const pending = render.prewarmSchedulePager(firstScreen, () => true, now);
  assert.equal(
    firstScreen.pager,
    undefined,
    "full pagination must yield before computing",
  );
  await finishPreparation();
  await pending;
  assert.deepEqual(
    firstScreen.pager,
    render.buildSchedulePager(
      null,
      localSchedule.plans,
      firstScreen.builtForDate,
      undefined,
      now,
    ),
  );
  assert.equal(firstScreen.pager.dayPages.length, 21);
  assert.equal(firstScreen.pager.weekPages.length, 3);
  const preparedDay = (offset) =>
    firstScreen.pager.dayPages.find(
      (day) => day.selectedDate === render.shiftScheduleDate(today, offset),
    );
  assert.equal(preparedDay(0).lateEntries[0].id, "overnight");
  assert.equal(preparedDay(1).timelineEntries[0].id, "overnight");
  assert.equal(preparedDay(7).entries[0].done, true);

  const buildPager = render.buildSchedulePager;
  render.buildSchedulePager = (...args) => {
    pagerBuilds++;
    return buildPager(...args);
  };
  const schedulePage = page("pages/schedule/index");
  schedulePage.onLoad();
  assert.equal(
    pagerBuilds,
    0,
    "first visit must consume the completed pager without rebuilding it",
  );
  assert.equal(schedulePage.data.dayPages, firstScreen.pager.dayPages);
  assert.equal(schedulePage.data.selectedDate, firstScreen.builtForDate);

  localSchedule.clientUpdatedAt = now.toISOString();
  localSchedule.plans = [];
  schedulePage.onLoad();
  assert.equal(
    pagerBuilds,
    1,
    "an edited or deleted schedule must invalidate precomputed pagination",
  );
  assert.ok(
    schedulePage.data.dayPages.every((day) => day.entries.length === 0),
    "deleted plans must never be restored from an older prepared pager",
  );
  localSchedule.clientUpdatedAt = null;

  let active = true;
  const canceled = render.prewarmScheduleFirstScreen(
    account,
    null,
    localSchedule,
    {},
    now,
  );
  const canceledPending = render.prewarmSchedulePager(
    canceled,
    () => active,
    now,
  );
  timers.shift()();
  await Promise.resolve();
  active = false;
  await finishPreparation();
  await canceledPending;
  assert.equal(
    canceled.pager,
    undefined,
    "a stale session must stop background preparation",
  );

  const superseded = render.prewarmScheduleFirstScreen(
    account,
    null,
    localSchedule,
    {},
    now,
  );
  const supersededPending = render.prewarmSchedulePager(
    superseded,
    () => true,
    now,
  );
  render.prewarmScheduleFirstScreen("account-b", null, localSchedule, {}, now);
  await finishPreparation();
  await supersededPending;
  assert.equal(
    superseded.pager,
    undefined,
    "an old task must not finish over a newer account snapshot",
  );
  assert.equal(render.getPrewarmedScheduleFirstScreen(account, now), null);

  const incomplete = render.prewarmScheduleFirstScreen(
    account,
    null,
    localSchedule,
    {},
    now,
  );
  schedulePage.onLoad();
  assert.equal(
    pagerBuilds,
    2,
    "an immediate visit must fall back without waiting for background work",
  );
  assert.equal(schedulePage.data.dayPages.length, 21);
  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  assert.equal(
    render.getPrewarmedScheduleFirstScreen(account, tomorrow),
    null,
    "midnight must expire the prepared date window",
  );
  assert.equal(incomplete.pager, undefined);

  const profile = load("data/profile-render");
  app.globalData.user = {
    account,
    name: "同学 A",
    profile: { gender: "男", grade: "2026级", className: "1班" },
  };
  const prepared = profile.prewarmProfileFirstScreen(account);
  const readsBeforeVisit = profileReads;
  const profilePage = page("pages/profile/index");
  profilePage.onLoad();
  assert.equal(
    profileReads,
    readsBeforeVisit,
    "profile first visit must use display state prepared on the home page",
  );
  assert.equal(profilePage.data.userName, "同学 A");
  assert.equal(profilePage.data.classLabel, "20261班");
  assert.equal(profile.getPrewarmedProfileFirstScreen(account), prepared);

  for (const source of Object.keys(revisions)) {
    revisions[source]++;
    assert.equal(
      profile.getPrewarmedProfileFirstScreen(account),
      null,
      source + " changes must invalidate prepared profile data",
    );
    profile.prewarmProfileFirstScreen(account);
  }
  systemTheme = "dark";
  assert.equal(
    profile.getPrewarmedProfileFirstScreen(account),
    null,
    "system dark mode must invalidate appearance without a preferences revision",
  );
  assert.equal(
    profile.prewarmProfileFirstScreen(account).appearance.theme,
    "dark",
  );
  account = "account-b";
  assert.equal(profile.getPrewarmedProfileFirstScreen("account-a"), null);
  assert.equal(
    profile.prewarmProfileFirstScreen(account).patch.userName,
    "同学",
    "another account must not inherit old identity data",
  );
  console.log("Background tab preparation checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
