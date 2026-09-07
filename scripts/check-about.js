const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "miniprogram");

function runtime() {
  const storage = new Map();
  const modules = new Map();
  let account = "alice";
  let failStorage = false;
  let now = new Date(2026, 8, 7, 12);
  let registeredAt = new Date(2026, 7, 20, 12).toISOString();
  let cachedUser = null;
  let profilePromise = Promise.resolve(null);
  let pageDefinition;
  const wx = {
    getStorageSync(key) {
      if (failStorage) throw new Error("Storage unavailable");
      return storage.get(key);
    },
    setStorageSync(key, value) {
      if (failStorage) throw new Error("Storage full");
      storage.set(key, structuredClone(value));
    },
    getAccountInfoSync: () => ({ miniProgram: { version: "2.3.4" } }),
    setNavigationBarColor() {},
  };
  class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
  }
  const stubs = {
    "store/session.ts": {
      getSession: () =>
        account ? { user: { id: account, account, registeredAt } } : null,
      captureSessionLease: () => (account ? { account } : null),
      isSessionLeaseCurrent: (lease) => lease?.account === account,
      loadCurrentUser: () => cachedUser,
    },
    "services/primary-tab-preload.ts": {
      getPreloadedCurrentUser: () => profilePromise,
    },
    "store/preferences.ts": { loadPreferences: () => ({}) },
    "utils/appearance.ts": {
      resolveAppearance: () => ({ theme: "light" }),
      syncWindowBackground() {},
    },
    "utils/navigation.ts": { ensureAuthenticated: () => Boolean(account) },
    "utils/haptics.ts": { haptic() {} },
  };
  function load(relativePath) {
    const normalized = relativePath.replaceAll("\\", "/");
    if (stubs[normalized]) return stubs[normalized];
    if (modules.has(normalized)) return modules.get(normalized).exports;
    const source = fs.readFileSync(path.join(root, normalized), "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText;
    const moduleRecord = { exports: {} };
    modules.set(normalized, moduleRecord);
    new Function("module", "exports", "require", "wx", "Date", "Page", output)(
      moduleRecord,
      moduleRecord.exports,
      (specifier) =>
        load(
          path.relative(
            root,
            path.resolve(root, path.dirname(normalized), `${specifier}.ts`),
          ),
        ),
      wx,
      Clock,
      (definition) => {
        pageDefinition = definition;
      },
    );
    return moduleRecord.exports;
  }
  return {
    load,
    storage,
    setAccount(value) {
      account = value;
    },
    setNow(value) {
      now = value;
    },
    setRegistration(value) {
      registeredAt = value;
    },
    setCachedUser(value) {
      cachedUser = value;
    },
    setProfilePromise(value) {
      profilePromise = value;
    },
    failStorage() {
      failStorage = true;
    },
    page() {
      load("features/pages/about/index.ts");
      return {
        ...pageDefinition,
        data: structuredClone(pageDefinition.data),
        setData(patch) {
          Object.assign(this.data, patch);
        },
      };
    },
  };
}

const app = runtime();
const tracker = app.load("services/visits.ts");
const historyStore = app.load("store/visits.ts");
const wall = app.load("features/utils/visit-wall.ts");
const count = (account, date = "2026-09-07") =>
  historyStore.loadVisitHistory(account).days[date] || 0;
tracker.startVisitTracking();
tracker.startVisitTracking();
tracker.syncVisitSession();
assert.equal(
  count("alice"),
  1,
  "Repeated lifecycle/session notifications must not count extra visits",
);

const page = app.page();
page.onShow();
page.onShow();
assert.equal(
  count("alice"),
  1,
  "Opening About and returning to it must not count as app opens",
);
assert.equal(page.data.wall.rows[0].days[12].level, 4);
assert.equal(
  page.data.accompaniedDays,
  19,
  "Count from registration, not the first local visit",
);
assert.equal(page.data.version, "2.3.4");
tracker.stopVisitTracking();
tracker.syncVisitSession();
assert.equal(count("alice"), 1, "Background work must not record a visit");
tracker.startVisitTracking();
assert.equal(count("alice"), 2, "Returning from the background counts once");

app.setAccount("bob");
tracker.syncVisitSession();
page.onShow();
assert.equal(count("bob"), 1);
assert.equal(
  page.data.wall.rows[0].days[12].count,
  1,
  "Account changes must replace the previous wall",
);
app.setAccount("alice");
tracker.syncVisitSession();
assert.equal(
  count("alice"),
  2,
  "Relogin in the same foreground entry must not double count",
);

tracker.stopVisitTracking();
app.setAccount("");
tracker.startVisitTracking();
app.setAccount("carol");
tracker.syncVisitSession();
assert.equal(
  count("carol"),
  1,
  "First login after a logged-out launch must record the visit",
);

tracker.stopVisitTracking();
app.setNow(new Date(2026, 8, 8, 0, 1));
tracker.startVisitTracking();
assert.equal(
  count("carol", "2026-09-08"),
  1,
  "Opens after local midnight belong to the new day",
);
assert.equal(count("carol", "2026-09-07"), 1);

const fixture = {
  version: 1,
  startedOn: "2026-09-01",
  days: { "2026-09-01": 1, "2026-09-02": 2, "2026-09-03": 4, "2026-09-04": 7 },
};
const chart = wall.buildVisitWall(fixture, new Date(2026, 8, 7, 12));
const bricks = chart.rows.flatMap((row) => row.days);
assert.equal(chart.rows.length, 7);
assert.equal(chart.months.length, 13);
assert.equal(bricks.length, 91);
assert.equal(new Set(bricks.map((brick) => brick.date)).size, 91);
assert.equal(
  bricks.reduce((sum, brick) => sum + brick.count, 0),
  14,
);
assert.equal(bricks.filter((brick) => brick.level > 0).length, 4);
assert.equal(bricks.filter((brick) => brick.future).length, 6);
const shortHistory = {
  version: 1,
  startedOn: "2026-06-01",
  days: { "2026-06-30": 99, "2026-07-15": 9, "2026-09-07": 1 },
};
const shortWall = wall.buildVisitWall(shortHistory, new Date(2026, 8, 7), 8);
const shortDays = shortWall.rows.flatMap((row) => row.days);
assert.equal(shortWall.months.length, 8);
assert.equal(shortDays.length, 56);
assert.equal(new Set(shortDays.map((day) => day.date)).size, 56);
assert.equal(shortWall.rows[0].days[0].date, "2026-07-20");
assert.equal(shortWall.rows[6].days[7].date, "2026-09-13");
assert.equal(shortDays.filter((day) => day.future).length, 6);
assert.equal(
  shortDays.find((day) => day.date === "2026-09-07").level,
  4,
  "The smaller print recalculates colors using only its eight visible weeks",
);
assert.equal(
  wall.buildVisitWall(shortHistory, new Date(2026, 8, 7)).months.length,
  13,
  "The About page keeps its full date range",
);
assert.equal(
  bricks.find((brick) => brick.date === "2026-08-31").recorded,
  false,
);
assert.equal(
  bricks.find((brick) => brick.date === "2026-09-05").recorded,
  true,
);
function levelsFor(counts) {
  const dates = counts.map((_, index) =>
    app.load("utils/date.ts").toDateString(new Date(2026, 8, index + 1)),
  );
  const rendered = wall.buildVisitWall(
    {
      version: 1,
      startedOn: "2026-09-01",
      days: Object.fromEntries(
        dates.map((date, index) => [date, counts[index]]),
      ),
    },
    new Date(2026, 8, 30),
  );
  const days = rendered.rows.flatMap((row) => row.days);
  return dates.map((date) => days.find((day) => day.date === date).level);
}
assert.deepEqual(
  levelsFor([1]),
  [4],
  "A single first visit gets the strongest green",
);
assert.deepEqual(levelsFor([0, 1, 1]), [0, 4, 4]);
assert.deepEqual(levelsFor([1, 2]), [3, 4]);
assert.deepEqual(levelsFor([1, 2, 3]), [2, 3, 4]);
assert.deepEqual(levelsFor([1, 2, 4, 7]), [1, 2, 3, 4]);
assert.deepEqual(levelsFor([0, 1, 2, 3, 4, 5]), [0, 1, 2, 3, 4, 4]);
assert.deepEqual(levelsFor([1, 1, 1, 2, 50, 100, 1000]), [1, 1, 1, 2, 3, 4, 4]);
const isolatedScale = wall.buildVisitWall(
  {
    version: 1,
    startedOn: "2026-09-01",
    days: {
      "2026-05-01": 999,
      "2026-08-01": 900,
      "2026-09-01": 1,
      "2026-10-01": 9999,
    },
  },
  new Date(2026, 8, 30),
);
assert.equal(
  isolatedScale.rows
    .flatMap((row) => row.days)
    .find((day) => day.date === "2026-09-01").level,
  4,
  "Future, unrecorded and off-screen history must not affect the visible scale",
);
assert.ok(
  wall
    .buildVisitWall({ version: 1, startedOn: "", days: {} })
    .rows.every((row) => row.days.every((brick) => brick.level === 0)),
);

for (const [registered, now, expected] of [
  [new Date(2026, 8, 7, 0, 1), new Date(2026, 8, 7, 23, 59), 1],
  [new Date(2026, 8, 7, 23, 59), new Date(2026, 8, 8, 0, 1), 2],
  [new Date(2026, 2, 7, 23, 59), new Date(2026, 2, 9, 0, 1), 3],
  [new Date(2026, 2, 28, 23, 59), new Date(2026, 2, 30, 0, 1), 3],
  [new Date(2026, 9, 31, 23, 59), new Date(2026, 10, 2, 0, 1), 3],
  [new Date(2024, 1, 28, 12), new Date(2024, 2, 1, 12), 3],
  [new Date(2026, 11, 31, 23, 59), new Date(2027, 0, 1, 0, 1), 2],
]) {
  assert.equal(
    wall.daysSinceRegistration(registered.toISOString(), now),
    expected,
  );
}
assert.equal(wall.daysSinceRegistration(null), null);
assert.equal(wall.daysSinceRegistration("invalid"), null);
assert.equal(
  wall.daysSinceRegistration(new Date(2027, 0, 1).toISOString()),
  null,
);
if (process.env.ABOUT_TIMEZONE_CHILD) {
  assert.equal(
    wall.daysSinceRegistration(
      "2026-09-06T23:30:00.000Z",
      new Date("2026-09-07T07:30:00.000Z"),
    ),
    { "Asia/Shanghai": 1, "America/New_York": 2, "Europe/London": 1 }[
      process.env.TZ
    ],
    "Convert the registration instant into the user's local date before counting days",
  );
}

async function checkRegistrationHydration() {
  const legacy = runtime();
  legacy.setRegistration(undefined);
  legacy.setCachedUser({
    id: "bob",
    account: "bob",
    registeredAt: new Date(2026, 0, 1).toISOString(),
  });
  const legacyPage = legacy.page();
  let resolveProfile;
  legacy.setProfilePromise(
    new Promise((resolve) => {
      resolveProfile = resolve;
    }),
  );
  legacyPage.onShow();
  assert.equal(
    legacyPage.data.accompaniedDays,
    null,
    "Never fall back to another account or local visit history",
  );
  resolveProfile({
    id: "alice",
    account: "alice",
    registeredAt: new Date(2026, 8, 1).toISOString(),
  });
  await Promise.resolve();
  assert.equal(
    legacyPage.data.accompaniedDays,
    7,
    "Older sessions hydrate the original registration time silently",
  );

  legacy.setProfilePromise(
    new Promise((resolve) => {
      resolveProfile = resolve;
    }),
  );
  legacyPage.onShow();
  legacy.setAccount("carol");
  resolveProfile({
    id: "alice",
    account: "alice",
    registeredAt: new Date(2026, 0, 1).toISOString(),
  });
  await Promise.resolve();
  assert.equal(
    legacyPage.data.accompaniedDays,
    null,
    "Ignore pending registration data after an account switch",
  );

  legacy.setProfilePromise(
    new Promise((resolve) => {
      resolveProfile = resolve;
    }),
  );
  legacyPage.onShow();
  legacyPage.onHide();
  resolveProfile({
    id: "carol",
    account: "carol",
    registeredAt: new Date(2026, 0, 1).toISOString(),
  });
  await Promise.resolve();
  assert.equal(
    legacyPage.data.accompaniedDays,
    null,
    "Do not update an inactive page",
  );

  legacy.setProfilePromise(Promise.reject(new Error("Offline")));
  legacyPage.onShow();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    legacyPage.data.accompaniedDays,
    null,
    "Missing registration data stays absent when offline",
  );
  legacy.setCachedUser({
    id: "carol",
    account: "carol",
    registeredAt: new Date(2026, 8, 1).toISOString(),
  });
  legacyPage.onShow();
  assert.equal(
    legacyPage.data.accompaniedDays,
    7,
    "Cached registration dates remain available offline",
  );
}

const reload = runtime();
for (const [key, value] of app.storage)
  reload.storage.set(key, structuredClone(value));
assert.equal(
  reload.load("store/visits.ts").loadVisitHistory("alice").days["2026-09-07"],
  2,
  "Visit history survives an app process restart",
);
assert.equal(
  reload.load("store/visits.ts").loadVisitHistory("bob").days["2026-09-07"],
  1,
);

const bad = runtime();
bad.storage.set("easy-swu:visits:v1:damaged", {
  version: 1,
  startedOn: "2026-01-01",
  days: {
    "2026-09-01": -2,
    "2026-02-30": 3,
    "2026-09-03": "9",
    "2026-09-04": 7,
  },
});
assert.deepEqual(bad.load("store/visits.ts").loadVisitHistory("damaged").days, {
  "2026-09-04": 7,
});
historyStore.recordVisit("retention", new Date(2024, 0, 1));
historyStore.recordVisit("retention", new Date(2026, 8, 7));
assert.deepEqual(historyStore.loadVisitHistory("retention").days, {
  "2026-09-07": 1,
});
app.failStorage();
historyStore.recordVisit("storage-error", new Date(2026, 8, 7));
historyStore.recordVisit("storage-error", new Date(2026, 8, 7));
assert.equal(
  count("storage-error"),
  2,
  "Full storage must not crash app launch or lose the in-memory count",
);

// Exercise calendar construction over DST and year boundaries in actual local time zones.
for (const now of [
  new Date(2026, 2, 15, 12),
  new Date(2026, 10, 8, 12),
  new Date(2027, 0, 2, 12),
]) {
  const rendered = wall.buildVisitWall(
    { version: 1, startedOn: "2025-01-01", days: {} },
    now,
  );
  const dates = rendered.rows
    .flatMap((row) => row.days)
    .map((brick) => brick.date)
    .sort();
  assert.equal(
    new Set(dates).size,
    91,
    "DST must not duplicate or skip calendar cells",
  );
  for (let i = 1; i < dates.length; i++) {
    const [year, month, day] = dates[i - 1].split("-").map(Number);
    const next = new Date(year, month - 1, day + 1);
    assert.equal(app.load("utils/date.ts").toDateString(next), dates[i]);
  }
}

if (!process.env.ABOUT_TIMEZONE_CHILD) {
  for (const timezone of [
    "Asia/Shanghai",
    "America/New_York",
    "Europe/London",
  ]) {
    const result = spawnSync(process.execPath, [__filename], {
      env: { ...process.env, TZ: timezone, ABOUT_TIMEZONE_CHILD: "1" },
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(
      result.status,
      0,
      `${timezone}: ${result.stderr || result.stdout}`,
    );
  }
}
checkRegistrationHydration()
  .then(() => {
    console.log(
      "About checks passed: visit lifecycle, account isolation, registration dates, local days, persistence and dynamic colors.",
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
