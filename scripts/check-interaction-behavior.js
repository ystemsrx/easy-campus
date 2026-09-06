const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "../miniprogram");

// Execute real controllers and render helpers with in-memory storage and API
// fixtures. No request reaches a service or modifies a user's account.
function runtime(overrides = {}) {
  const storage = new Map();
  const modules = new Map();
  let definition;
  let session = {
    user: { account: "account-a" },
    token: "token-a",
    signedInAt: 1,
  };
  let plans = [];
  let revision = 0;
  const timers = [];
  const jsTasks = [];
  const renders = [];
  let deferred = false;
  let pagerWidth = 375;
  let weekWidth = 335;
  let trackingStyle;
  const wx = {
    getStorageSync: (key) => structuredClone(storage.get(key)),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key) => storage.delete(key),
    getWindowInfo: () => ({ windowWidth: 375 }),
    worklet: {
      shared: (initial) => {
        let value = initial;
        const listeners = new Set();
        return {
          get value() {
            if (trackingStyle) listeners.add(trackingStyle);
            return value;
          },
          set value(next) {
            if (next === value) return;
            value = next;
            for (const listener of listeners) listener();
          },
        };
      },
      runOnJS:
        (fn) =>
        (...args) =>
          deferred ? jsTasks.push(() => fn(...args)) : fn(...args),
    },
    nextTick: (callback) => callback(),
    showToast() {},
    showModal() {},
  };
  const stubs = {
    "utils/appearance": {
      resolveAppearance: () => ({ motionClass: "motion-normal" }),
      syncWindowBackground() {},
    },
    "utils/haptics": { haptic() {} },
    "utils/navigation": {
      ensureAuthenticated: () => true,
      navigateTo: async () => true,
    },
    "store/preferences": {
      loadPreferences: () => ({}),
      getPreferencesRevision: () => 0,
    },
    "store/session": {
      getSession: () => session,
      captureSessionLease: () => ({
        account: session.user.account,
        token: session.token,
      }),
      isSessionLeaseCurrent: (lease) =>
        lease.account === session.user.account && lease.token === session.token,
      sessionLeaseKey: (lease) => lease.account + lease.token,
    },
    "store/timetable": {
      getTimetableRevision: () => 0,
      loadTimetableSnapshot: () => null,
    },
    "store/schedule": {
      getScheduleRevision: () => revision,
      loadScheduleData: () => ({ plans, clientUpdatedAt: String(revision) }),
      saveScheduleData: (_account, next) => {
        plans = next;
        return { plans, clientUpdatedAt: String(++revision) };
      },
    },
    "services/teaching": { putLocalSchedule: async () => undefined },
    "services/primary-tab-preload": {},
    "services/request": { getErrorMessage: (_error, fallback) => fallback },
    ...overrides,
  };
  function load(relative) {
    const normalized = relative.replace(/\\/g, "/").replace(/\.ts$/, "");
    if (stubs[normalized]) return stubs[normalized];
    if (modules.has(normalized)) return modules.get(normalized).exports;
    const record = { exports: {} };
    modules.set(normalized, record);
    const file = path.join(root, normalized + ".ts");
    const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText;
    new Function(
      "module",
      "exports",
      "require",
      "Page",
      "wx",
      "getApp",
      "setTimeout",
      "clearTimeout",
      js,
    )(
      record,
      record.exports,
      (id) => load(path.relative(root, path.resolve(path.dirname(file), id))),
      (value) => {
        definition = value;
      },
      wx,
      () => ({ globalData: { preferences: {} } }),
      (callback) => {
        timers.push(callback);
        return timers.length;
      },
      () => undefined,
    );
    return record.exports;
  }
  function page(relative) {
    load(relative);
    function applyPatch(data, patch) {
      for (const [key, value] of Object.entries(patch)) {
        const segments = key.replace(/\[(\d+)\]/g, ".$1").split(".");
        let target = data;
        for (const part of segments.slice(0, -1)) target = target[part];
        target[segments.at(-1)] = value;
      }
    }
    const instance = {
      ...definition,
      data: structuredClone(definition.data),
      renderedData: structuredClone(definition.data),
      setData(patch, callback) {
        applyPatch(this.data, patch);
        const submitted = structuredClone(patch);
        const render = () => {
          this.onRenderPatch?.(submitted, this.renderedData);
          applyPatch(this.renderedData, submitted);
          callback?.();
        };
        if (deferred) renders.push(render);
        else render();
      },
      getTabBar: () => ({ setData() {} }),
      animatedStyles: new Map(),
      appliedStyles: new Map(),
      missingStyleNodes: [],
      styleBindings: 0,
      applyAnimatedStyle(selector, updater, config, callback) {
        // A selector binds the nodes present in the rendered wx:for. An
        // attempted binding on an empty first render does not bind future nodes.
        const slot = /\.week-(?:strip-slot|selection-slot|date)-(\d)/.exec(
          selector,
        )?.[1];
        if (
          slot !== undefined &&
          !this.renderedData.weekPages?.[Number(slot)]
        ) {
          this.missingStyleNodes.push(selector);
          return;
        }
        this.animatedStyles.set(selector, updater);
        const refresh = () => {
          trackingStyle = refresh;
          try {
            this.appliedStyles.set(selector, updater());
          } finally {
            trackingStyle = undefined;
          }
        };
        refresh();
        const styleId = ++this.styleBindings;
        if (callback) {
          if (deferred) renders.push(() => callback({ styleId }));
          else callback({ styleId });
        }
      },
      createSelectorQuery() {
        return {
          select() {
            return this;
          },
          boundingClientRect() {
            return this;
          },
          exec(callback) {
            callback([{ width: pagerWidth }, { width: weekWidth }]);
          },
        };
      },
    };
    for (const [key, value] of Object.entries(instance))
      if (typeof value === "function") instance[key] = value.bind(instance);
    return instance;
  }
  return {
    load,
    page,
    wx,
    timers,
    storage,
    setSession: (value) => {
      session = value;
    },
    setPlans: (value) => {
      plans = value;
      revision++;
    },
    getPlans: () => plans,
    defer: () => {
      deferred = true;
    },
    flushJS: () => {
      while (jsTasks.length) jsTasks.shift()();
    },
    flushRenders: () => {
      while (renders.length) renders.shift()();
    },
    resize: (pager, week) => {
      pagerWidth = pager;
      weekWidth = week;
    },
  };
}

function event(dataset = {}, detail = {}) {
  return { currentTarget: { dataset }, detail };
}
function checkScheduleMotionMount() {
  // Exercise both legal orderings: page ready before the async date render,
  // and date nodes ready before the page's ready lifecycle.
  for (const readyFirst of [true, false]) {
    const env = runtime();
    const render = env.load("data/schedule-render");
    const page = env.page("pages/schedule/index");
    env.defer();
    page.onLoad();
    assert.equal(page.renderedData.weekPages.length, 0);
    if (readyFirst) page.onReady();
    env.flushRenders();
    if (!readyFirst) page.onReady();
    env.flushRenders();
    assert.equal(
      page.appliedStyles.size,
      48,
      "Bind every marker, strip and glyph after its node exists",
    );
    assert.deepEqual(
      page.missingStyleNodes,
      [],
      "Never try to bind the empty initial wx:for",
    );
    assert.equal(page.renderedData.headerMotionReady, true);
    // Inspect styles applied by SharedValue subscriptions, never manually
    // invoke updater callbacks: correct math alone cannot move a real node.
    page.setData({ selectedDate: "2026-09-11" });
    page.rebuildWeek(true);
    env.flushRenders();
    const origin = render.scheduleDayIndex(page.data.selectedDate);
    const slot = Math.floor(origin / 7) % 3;
    page.onDayScrollStart();
    for (const progress of [0.1, 0.25, 0.5, 0.75, 0.4, 0.1, 0]) {
      page.onDayScrollUpdate(event({}, { dx: 375 * progress }));
      const marker = page.appliedStyles.get(
        ".week-selection-slot-" + slot,
      ).transform;
      const x = Number(/translateX\((.*)px\)/.exec(marker)[1]);
      assert.ok(Math.abs(x - ((4 + progress) * 335) / 7) < 1e-7);
      for (const [weekday, weight] of [
        [5, 1 - progress],
        [6, progress],
      ]) {
        for (const selected of [false, true]) {
          const selector =
            ".week-date-" +
            slot +
            "-" +
            weekday +
            (selected ? "-selected" : "-normal");
          assert.ok(
            Math.abs(
              Number(page.appliedStyles.get(selector).opacity) -
                (selected ? weight : 1 - weight),
            ) < 1e-7,
          );
        }
      }
      assert.equal(
        page.data.selectedDate,
        "2026-09-11",
        "Visual motion must precede the selected-date commit",
      );
    }
    page.onDayScrollEnd(event({}, { dx: 0 }));
    env.flushJS();
    env.flushRenders();
    page.onHide();
    env.flushRenders();
    page.onShow();
    env.flushRenders();
    assert.equal(
      page.styleBindings,
      48,
      "Keyed header nodes keep their bindings across window resets and tab returns",
    );
  }
  const template = fs.readFileSync(
    path.join(root, "pages/schedule/index.wxml"),
    "utf8",
  );
  const styles = fs.readFileSync(
    path.join(root, "pages/schedule/index.wxss"),
    "utf8",
  );
  const header = template.slice(
    template.indexOf('class="week-viewport"'),
    template.indexOf("<swiper"),
  );
  assert.ok(
    !header.includes("transform:"),
    "Inline transforms must not compete with animated transforms",
  );
  assert.ok(
    !header.includes("week-day--active") &&
      !styles.includes(".week-day--active"),
    "Committed selection must not abruptly override animated glyph opacity",
  );
}
function checkSchedule() {
  const env = runtime();
  const render = env.load("data/schedule-render");
  const now = new Date(2026, 8, 7, 12);
  const plan = {
    id: "overnight",
    title: "跨夜安排",
    date: "2026-09-13",
    startTime: "23:00",
    endDate: "2026-09-14",
    endTime: "01:00",
    done: false,
  };
  const start = render.buildScheduleDateView(null, [plan], plan.date, now);
  const end = render.buildScheduleDateView(null, [plan], plan.endDate, now);
  assert.equal(start.lateEntries[0].id, plan.id);
  assert.equal(end.earlyEntries[0].id, plan.id);
  assert.equal(end.days[0].hasPlan, true);
  assert.equal(
    end.days.some((day) => day.isToday),
    false,
    "Browsing another week must not relabel its Monday as today",
  );
  assert.equal(
    render.buildScheduleDateView(
      null,
      [{ ...plan, endTime: "00:00" }],
      plan.endDate,
      now,
    ).entries.length,
    0,
    "Midnight endpoints are exclusive",
  );
  const multi = {
    ...plan,
    date: "2026-09-12",
    startTime: "07:00",
    endDate: "2026-09-15",
    endTime: "23:50",
  };
  for (const date of [multi.date, "2026-09-13", "2026-09-14", multi.endDate]) {
    const view = render.buildScheduleDateView(null, [multi], date, now);
    assert.equal(view.entries.length, 1);
    assert.ok(view.entries[0].timeLabel.includes("2026-09-15"));
    assert.ok(
      view.timelineEntries.every(
        (entry) =>
          entry.top >= 0 &&
          entry.top + entry.height <= render.SCHEDULE_TIMELINE_HEIGHT,
      ),
    );
  }
  const page = env.page("pages/schedule/index");
  page.onLoad();
  page.onReady();
  page.setData({ selectedDate: "2026-09-13" });
  page.rebuildWeek();
  function assertDateBlend(date, selectedWeight) {
    const day = render.scheduleDayIndex(date);
    const selector =
      ".week-date-" + (Math.floor(day / 7) % 3) + "-" + ((day % 7) + 1);
    assert.equal(
      Number(page.animatedStyles.get(selector + "-selected")().opacity),
      selectedWeight,
    );
    assert.equal(
      Number(page.animatedStyles.get(selector + "-normal")().opacity),
      1 - selectedWeight,
    );
  }
  function assertHeaderAligned(date) {
    const dayIndex = render.scheduleDayIndex(date);
    const slot = Math.floor(dayIndex / 7) % 3;
    const weekday = dayIndex % 7;
    assert.equal(
      page.data.weekPages[slot].days[weekday].date,
      date,
      "The visible label must be the actual native panel's date",
    );
    assert.equal(page._motion.position.value, dayIndex);
    assert.equal(
      page.animatedStyles.get(".week-strip-slot-" + slot)().transform,
      "translateX(0px)",
    );
    assert.equal(
      page.animatedStyles.get(".week-selection-slot-" + slot)().transform,
      "translateX(" + (weekday * page._motion.weekWidth.value) / 7 + "px)",
      "The selector must land at the center of the corresponding date cell",
    );
    assertDateBlend(date, 1);
  }
  function swipe(direction) {
    const before = page.data.selectedDate;
    const slot = page.data.dayCurrent + direction;
    const dates = page.data.dayPages.map((day) => day.selectedDate);
    page.onDayScrollStart(event({}, { dx: 0 }));
    page.onDayScrollUpdate(event({}, { dx: direction * 375 }));
    page.onDayChange(event({}, { current: slot }));
    assert.deepEqual(
      page.data.dayPages.map((day) => day.selectedDate),
      dates,
      "All native date identities stay intact until scrolling ends",
    );
    page.onDayScrollEnd(event({}, { dx: direction * 375 }));
    env.flushJS();
    // A rebase has changed the native window but its render callback is still
    // pending. Absolute calendar coordinates must keep the header unchanged.
    assertHeaderAligned(render.shiftScheduleDate(before, direction));
    env.flushRenders();
    assert.equal(
      page.data.selectedDate,
      render.shiftScheduleDate(before, direction),
    );
    assert.equal(page.data.dayPages.length, 21);
    assert.equal(
      page.data.dayPages[page.data.dayCurrent].selectedDate,
      page.data.selectedDate,
    );
    assert.equal(
      page._motion.position.value,
      render.scheduleDayIndex(page.data.selectedDate),
    );
    for (let i = 1; i < 21; i++)
      assert.equal(
        page.data.dayPages[i].selectedDate,
        render.shiftScheduleDate(page.data.dayPages[i - 1].selectedDate, 1),
      );
  }
  page.onDayScrollStart();
  page.onDayScrollUpdate(event({}, { dx: 187.5 }));
  assert.equal(page.data.selectedDate, "2026-09-13");
  assertDateBlend("2026-09-13", 0.5);
  assertDateBlend("2026-09-14", 0.5);
  assert.equal(
    page.animatedStyles.get(
      ".week-strip-slot-" +
        (Math.floor(render.scheduleDayIndex(page.data.selectedDate) / 7) % 3),
    )().transform,
    "translateX(-167.5px)",
    "Sunday's next week follows a half swipe",
  );
  page.onDayScrollUpdate(event({}, { dx: 281.25 }));
  assertDateBlend("2026-09-13", 0.25);
  assertDateBlend("2026-09-14", 0.75);
  page.onDayScrollUpdate(event({}, { dx: 93.75 }));
  assertDateBlend("2026-09-13", 0.75);
  assertDateBlend("2026-09-14", 0.25);
  page.onDayScrollUpdate(event({}, { dx: 0 }));
  assertDateBlend("2026-09-13", 1);
  assertDateBlend("2026-09-14", 0);
  page.onDayScrollEnd(event({}, { dx: 0 }));
  assert.equal(
    page.data.selectedDate,
    "2026-09-13",
    "A cancelled swipe must not commit a new day",
  );
  swipe(1);
  assert.equal(page.data.selectedDate, "2026-09-14");
  // The same progress mapping applies within a week, including a reversal
  // before any native current / selectedDate event is delivered.
  page.onDayScrollStart();
  page.onDayScrollUpdate(event({}, { dx: 187.5 }));
  assertDateBlend("2026-09-14", 0.5);
  assertDateBlend("2026-09-15", 0.5);
  page.onDayScrollUpdate(event({}, { dx: 0 }));
  assertDateBlend("2026-09-14", 1);
  assertDateBlend("2026-09-15", 0);
  page.onDayScrollEnd(event({}, { dx: 0 }));
  swipe(-1);
  assert.equal(page.data.selectedDate, "2026-09-13");
  for (let i = 0; i < 120; i++) swipe(1);
  for (let i = 0; i < 120; i++) swipe(-1);
  // Worklet end must advance its baseline even while JS is busy and cannot
  // deliver the previous finish. Ordinary synchronous mocks missed this bug.
  env.defer();
  const initial = page.data.dayCurrent;
  const initialDay = render.scheduleDayIndex(page.data.selectedDate);
  page.onDayScrollStart();
  page.onDayChange(event({}, { current: initial + 1 }));
  page.onDayScrollEnd(event({}, { dx: 375 }));
  page.onDayScrollStart();
  page.onDayScrollUpdate(event({}, { dx: 187.5 }));
  assert.equal(page._motion.position.value, initialDay + 1.5);
  assertDateBlend("2026-09-14", 0.5);
  assertDateBlend("2026-09-15", 0.5);
  page.onDayChange(event({}, { current: initial + 2 }));
  page.onDayScrollEnd(event({}, { dx: 375 }));
  env.flushJS();
  env.flushRenders();
  assert.equal(page.data.selectedDate, "2026-09-15");
  swipe(-1);
  swipe(-1);
  function finishTap() {
    const dx =
      (render.scheduleDayIndex(
        page.data.dayPages[page.data.dayCurrent].selectedDate,
      ) -
        page._motion.start.value) *
      375;
    page.onDayScrollStart();
    page.onDayScrollUpdate(event({}, { dx: dx / 2 }));
    const midway = page._motion.position.value;
    for (const day of page.data.dayPages) {
      if (Math.abs(render.scheduleDayIndex(day.selectedDate) - midway) <= 1)
        assertDateBlend(
          day.selectedDate,
          Math.max(
            0,
            1 - Math.abs(render.scheduleDayIndex(day.selectedDate) - midway),
          ),
        );
    }
    page.onDayChange(event({}, { current: page.data.dayCurrent }));
    page.onDayScrollEnd(event({}, { dx }));
    env.flushJS();
    env.flushRenders();
  }
  const datesBeforeTap = page.data.dayPages.map((day) => day.selectedDate);
  page.navigateScheduleDate("2026-09-09");
  page.navigateScheduleDate("2026-09-11");
  assert.deepEqual(
    page.data.dayPages.map((day) => day.selectedDate),
    datesBeforeTap,
    "Tapping Wednesday must select its real index, never overwrite an adjacent day",
  );
  assert.equal(
    page.data.dayPages[page.data.dayCurrent].selectedDate,
    "2026-09-09",
  );
  finishTap();
  finishTap();
  assert.equal(
    page.data.selectedDate,
    "2026-09-11",
    "Quick date taps must retain the latest intent",
  );
  swipe(1);
  assert.equal(
    page.data.selectedDate,
    "2026-09-12",
    "A swipe after a multi-day tap still advances exactly one real day",
  );
  swipe(-1);
  page.onDayScrollStart(event({}, { dx: 0 }));
  env.setPlans([plan]);
  page.rebuildWeek();
  page.onDayScrollEnd(event({}, { dx: 0 }));
  env.flushJS();
  env.flushRenders();
  assert.equal(
    page.data.selectedDate,
    "2026-09-11",
    "A background update must not reset the viewed date",
  );
  page.openCreator();
  page.onTitleInput(event({}, { value: "保存到下个月" }));
  page.onStartDateChange(event({}, { value: "2026-10-12" }));
  page.onStartTimeChange(event({}, { value: "23:00" }));
  page.closeCreator();
  page.openCreator();
  assert.equal(page.data.title, "保存到下个月");
  assert.equal(page.data.startDate, "2026-10-12");
  page.savePlan();
  env.flushRenders();
  assert.equal(page.data.selectedDate, "2026-10-12");
  assert.equal(
    page.data.dayPages[page.data.dayCurrent].lateEntries.at(-1).title,
    "保存到下个月",
  );
  assert.ok(page.data.focusedPlanId);
  const savedCount = env.getPlans().length;
  page.savePlan();
  assert.equal(
    env.getPlans().length,
    savedCount,
    "Double tapping save must not duplicate a plan",
  );
  page.openCreator();
  assert.equal(page.data.title, "", "Successful saves clear the draft");
  page.onHide();
  env.flushRenders();
  page.rebuildWeek();
  assert.equal(page.data.selectedDate, "2026-10-12");
  page.onDayScrollStart(event({}, { dx: 0 }));
  page.openCreator();
  page.onTitleInput(event({}, { value: "滑动途中保存" }));
  page.onStartDateChange(event({}, { value: "2026-11-02" }));
  page.savePlan();
  page.onDayScrollEnd(event({}, { dx: 0 }));
  env.flushJS();
  env.flushRenders();
  assert.equal(page.data.selectedDate, "2026-11-02");
  assert.equal(page.data.focusedPlanId, env.getPlans().at(-1).id);
  // A distant jump/rebase is non-animated. Its native callbacks cannot alter
  // the chosen date or add the internal repositioning to gesture progress.
  page.navigateScheduleDate("2028-02-28");
  assert.equal(page.data.dayAnimated, false);
  const nativeCurrent = page.data.dayCurrent;
  page.onDayScrollStart();
  page.onDayChange(event({}, { current: nativeCurrent }));
  page.onDayScrollEnd(event({}, { dx: -7 * 375 }));
  env.flushJS();
  env.flushRenders();
  assert.equal(page.data.selectedDate, "2028-02-28");
  page.onDayChange(event({ windowStart: "2026-10-26" }, { current: 20 }));
  assert.equal(
    page._nativeCurrent,
    nativeCurrent,
    "A late native change from the old date window is ignored",
  );
  swipe(1);
  assert.equal(page.data.selectedDate, "2028-02-29");
  swipe(1);
  assert.equal(page.data.selectedDate, "2028-03-01");
  page.navigateScheduleDate("2026-12-31");
  env.flushRenders();
  swipe(1);
  assert.equal(page.data.selectedDate, "2027-01-01");
  // Use measured viewport widths, including non-full-screen/narrow layouts.
  env.resize(320, 280);
  page.onResize();
  const origin = render.scheduleDayIndex(page.data.selectedDate);
  page.onDayScrollStart();
  page.onDayScrollUpdate(event({}, { dx: 160 }));
  assert.equal(page._motion.position.value, origin + 0.5);
  const week = Math.floor(origin / 7);
  const marker = page.animatedStyles.get(".week-selection-slot-" + (week % 3))()
    .transform;
  assert.equal(marker, "translateX(" + (origin + 0.5 - week * 7) * 40 + "px)");
  page.onDayScrollEnd(event({}, { dx: 0 }));
  env.flushJS();
  const distantDate = page.data.dayPages[0].selectedDate;
  page.navigateScheduleDate(distantDate);
  assert.equal(
    page.data.dayAnimated,
    false,
    "Distant jumps do not animate through weeks whose header has not been mounted",
  );
  env.flushRenders();
  assertHeaderAligned(distantDate);
  page.setData({ motionClass: "motion-reduced" });
  page.navigateScheduleDate("2027-01-03");
  env.flushRenders();
  assert.equal(
    page.data.selectedDate,
    "2027-01-03",
    "Reduced motion cannot depend on a zero-duration finish event",
  );
}

function checkScheduleSettling() {
  const env = runtime();
  const render = env.load("data/schedule-render");
  const page = env.page("pages/schedule/index");
  page.onLoad();
  page.onReady();
  page.setData({ selectedDate: "2026-09-11" });
  page.rebuildWeek(true);
  env.defer();
  const styles = () =>
    [...page.animatedStyles].map(([selector, update]) => [selector, update()]);
  function assertIdleTailIgnored(dx) {
    const before = styles();
    const date = page.data.selectedDate;
    const sequence = page._motion.sequence.value;
    for (const tail of [dx, dx + Math.sign(dx) * 2, 0]) {
      page.onDayScrollUpdate(event({}, { dx: tail, state: 2 }));
      assert.deepEqual(
        styles(),
        before,
        "A late scroll update cannot move the resting selector or its colors",
      );
      page.onDayScrollEnd(event({}, { dx: tail, state: 2 }));
      assert.deepEqual(
        styles(),
        before,
        "A duplicate end cannot count the same displacement again",
      );
    }
    env.flushJS();
    env.flushRenders();
    assert.equal(page.data.selectedDate, date);
    assert.equal(page._motion.sequence.value, sequence);
  }
  function swipe(direction) {
    const expected = render.shiftScheduleDate(
      page.data.selectedDate,
      direction,
    );
    const current = page.data.dayCurrent + direction;
    page.onDayScrollStart();
    page.onDayScrollUpdate(event({}, { dx: direction * 375 }));
    page.onDayChange(event({}, { current }));
    page.onDayScrollEnd(event({}, { dx: direction * 375 }));
    const stopped = page._motion.position.value;
    // Native tail notifications may arrive before JS has committed the date.
    page.onDayScrollUpdate(event({}, { dx: direction * 375, state: 2 }));
    assert.equal(
      page._motion.position.value,
      stopped,
      "An end-frame displacement is consumed only once",
    );
    env.flushJS();
    env.flushRenders();
    assert.equal(page.data.selectedDate, expected);
    assert.equal(
      page._motion.position.value,
      render.scheduleDayIndex(expected),
    );
    assertIdleTailIgnored(direction * 375);
  }
  // Stop at Sunday after two swipes, then Monday after another swipe; repeat
  // in reverse. No extra gesture is sent while the tail notifications drain.
  for (const direction of [1, 1, 1, -1, -1, -1]) swipe(direction);

  let rebases = 0;
  page.onRenderPatch = (patch, nativeData) => {
    const replacing =
      patch.dayPages &&
      patch.dayPages[0].selectedDate !== nativeData.dayPages[0].selectedDate;
    if (replacing) {
      rebases += 1;
      assert.equal(
        nativeData.dayAnimated,
        false,
        "Disable animation in an acknowledged render before replacing dates/current",
      );
    }
    if (replacing || patch.dayAnimated === true) {
      assert.equal(
        page._motion.ready.value,
        0,
        "Internal positioning stays gated through animation re-enabling",
      );
      const before = styles();
      page.onDayScrollStart();
      page.onDayScrollUpdate(event({}, { dx: -7 * 375 }));
      page.onDayScrollEnd(event({}, { dx: -7 * 375 }));
      assert.deepEqual(
        styles(),
        before,
        "Internal current changes must never animate the date header",
      );
    }
  };
  for (let count = 0; count < 22; count += 1) swipe(1);
  for (let count = 0; count < 30; count += 1) swipe(-1);
  assert.ok(rebases >= 2, "Exercise both date-window boundaries");
  const keptDate = page.data.selectedDate;
  page.onRenderPatch = (patch) => {
    assert.notEqual(
      patch.selectedDate,
      "2030-01-01",
      "A superseded rebase must not briefly render its old target",
    );
  };
  page.navigateScheduleDate("2030-01-01");
  page.onHide();
  env.flushRenders();
  assert.equal(page.data.selectedDate, keptDate);
}

function checkRoomsAndDraftStorage() {
  const env = runtime({ "features/services/rooms": {} });
  const drafts = env.load("store/interaction-drafts");
  drafts.saveInteractionDraft(
    "a",
    "review",
    { rating: 4, keywords: ["讲得好"], content: "已输入内容" },
    "course-1",
  );
  assert.equal(drafts.loadInteractionDraft("b", "review", "course-1"), null);
  assert.equal(drafts.loadInteractionDraft("a", "review", "course-2"), null);
  assert.equal(
    drafts.loadInteractionDraft("a", "review", "course-1").rating,
    4,
  );
  drafts.clearInteractionDraft("a", "review", "course-1");
  assert.equal(drafts.loadInteractionDraft("a", "review", "course-1"), null);
  env.wx.setStorageSync = () => {
    throw new Error("storage full");
  };
  env.wx.removeStorageSync = () => {
    throw new Error("storage unavailable");
  };
  drafts.saveInteractionDraft("a", "feedback", {
    type: "bug",
    content: "未能写入磁盘也保留当前输入",
  });
  assert.equal(
    drafts.loadInteractionDraft("a", "feedback").content,
    "未能写入磁盘也保留当前输入",
  );
  drafts.clearInteractionDraft("a", "feedback");
  assert.equal(drafts.loadInteractionDraft("a", "feedback"), null);
  const page = env.page("features/pages/rooms/index");
  page.setData({
    selectedPeriods: [1, 2],
    draftPeriods: [],
    periods: [],
    periodGroups: [],
    hasQueried: true,
    periodLabel: "第 1–2 节",
  });
  page.closePeriodPicker();
  assert.deepEqual(page.data.selectedPeriods, [1, 2]);
  assert.equal(page.data.hasQueried, true);
  page.setData({ draftPeriods: [], pickerVisible: true });
  page.applyPeriodPicker();
  assert.equal(page.data.pickerVisible, true);
  assert.deepEqual(page.data.selectedPeriods, [1, 2]);
  page.setData({ draftPeriods: [4, 3] });
  page.applyPeriodPicker();
  assert.deepEqual(page.data.selectedPeriods, [3, 4]);
  assert.equal(page.data.hasQueried, false);
}

async function checkCourseAssistant() {
  const key = "a".repeat(64),
    second = "b".repeat(64);
  const access = {
    allowed: true,
    requiresContribution: false,
    ownReviewCount: 1,
  };
  const makeCourse = (courseKey) => ({
    courseKey,
    type: "general_elective",
    displayName: "收藏课程",
    courseName: "收藏课程",
    sportName: null,
    teacherNames: ["老师"],
    credits: 2,
    averageScore: 90,
    rating: 4,
    keywords: [],
    reviewAccess: access,
  });
  let favorites = [key, second],
    failSecond = true,
    fetches = [],
    published = [];
  const env = runtime({
    "features/store/course-assistant": {
      loadCourseAssistantFavorites: () => favorites,
      toggleCourseAssistantFavorite: (_account, key) =>
        (favorites = favorites.filter((item) => item !== key)),
    },
    "features/services/course-assistant": {
      getCourseAssistantCourse: async (key) => {
        fetches.push(key);
        if (key === second && failSecond) throw new Error("offline");
        return makeCourse(key);
      },
      getCourseAssistantCatalog: async () => ({
        items: [],
        pagination: { totalPages: 1 },
        summary: {},
        keywords: { positive: [] },
        reviewAccess: access,
      }),
      getMyCourseAssistantData: async () => ({
        grades: [],
        reviews: [],
        keywords: { positive: [], neutral: [], negative: [] },
        reviewAccess: access,
      }),
      publishCourseAssistantReview: async (value) => {
        published.push(value);
      },
    },
  });
  const page = env.page("features/pages/course-assistant/index");
  page.onShow();
  page.setData({ favoritesOnly: true });
  await page.loadFavorites();
  assert.equal(
    page.data.courses[0].courseKey,
    key,
    "Unloaded catalog pages must not hide saved favorites",
  );
  assert.ok(page.data.favoritesError);
  assert.equal(page.data.favoritesLoading, false);
  failSecond = false;
  await page.loadFavorites();
  assert.equal(page.data.courses.length, 2);
  assert.equal(page.data.favoritesError, "");
  assert.deepEqual(
    fetches,
    [key, second, second],
    "Retry only missing favorites",
  );
  page.onCourseScroll(event({ tab: "browse" }, { scrollTop: 845 }));
  page.switchTab(event({ tab: "publish" }));
  page.onCourseScroll(event({ tab: "publish" }, { scrollTop: 123 }));
  page.switchTab(event({ tab: "browse" }));
  assert.equal(page.data.browseScrollTop, 845);
  assert.equal(page.data.publishScrollTop, 123);
  const grade = { ...makeCourse(key), termLabel: "2026 秋", scoreLabel: "90" };
  page.prepareReview(grade);
  page.selectRating(event({ rating: 4 }));
  page.onReviewTextInput(event({}, { value: "这是一份不应该丢失的课程想法" }));
  page.toggleReviewKeyword(event({ keyword: "讲得好" }));
  page.closeReview();
  page.prepareReview(grade);
  assert.equal(page.data.selectedRating, 4);
  assert.equal(page.data.reviewText, "这是一份不应该丢失的课程想法");
  page.prepareReview({ ...grade, courseKey: second });
  assert.equal(page.data.reviewText, "");
  page.prepareReview(grade);
  assert.equal(page.data.selectedRating, 4);
  await page.submitReview();
  assert.equal(published.length, 1);
  assert.equal(published[0].keywords[0], "讲得好");
  page.prepareReview(grade);
  assert.equal(page.data.reviewText, "");
}

async function checkFeedback() {
  let fail = true;
  const env = runtime({
    "services/auth": {},
    "services/auto-dorm-check": {},
    "services/feedback": {
      submitFeedback: async () => {
        if (fail) throw new Error("daily-limit");
      },
    },
    "services/request": {
      getErrorMessage: () => "请稍后重试",
      isFeedbackDailyLimitError: () => true,
    },
  });
  const page = env.page("pages/profile/index");
  page.setData({ account: "account-a" });
  page.openFeedback();
  page.selectFeedbackType(event({ type: "bug" }));
  page.onFeedbackContentInput(event({}, { value: "关闭后应保留的反馈内容" }));
  page.closeFeedback();
  page.openFeedback();
  assert.equal(page.data.feedbackType, "bug");
  assert.equal(page.data.feedbackContent, "关闭后应保留的反馈内容");
  await page.submitFeedback();
  page.openFeedback();
  assert.equal(
    page.data.feedbackContent,
    "关闭后应保留的反馈内容",
    "Submission limits must not discard unsent feedback",
  );
  env.setSession({ user: { account: "account-b" }, token: "token-b" });
  page.closeFeedback();
  page.setData({ account: "account-b" });
  page.openFeedback();
  assert.equal(page.data.feedbackContent, "");
  env.setSession({ user: { account: "account-a" }, token: "token-a" });
  page.closeFeedback();
  page.setData({ account: "account-a" });
  page.openFeedback();
  assert.equal(page.data.feedbackContent, "关闭后应保留的反馈内容");
  fail = false;
  await page.submitFeedback();
  page.openFeedback();
  assert.equal(page.data.feedbackContent, "");
}

async function main() {
  checkScheduleMotionMount();
  checkScheduleSettling();
  checkSchedule();
  checkRoomsAndDraftStorage();
  await checkCourseAssistant();
  await checkFeedback();
  console.log(
    "Interaction behavior checks passed: dates, 240 consecutive swipes, cancellation, rapid taps, drafts, favorites, picker commit/cancel.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
