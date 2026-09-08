const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../miniprogram");
const compiled = new Map();
let instant = new Date(2026, 8, 8, 8).getTime();
class ClockDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [instant]));
  }
  static now() {
    return instant;
  }
}

function boot(storage = new Map()) {
  const modules = new Map();
  const app = {
    globalData: {
      session: null,
      user: null,
      preferences: null,
      foregroundEntryId: 1,
    },
  };
  const network = [];
  const platformCalls = [];
  let appAvailable = true;
  let page;
  let route = "pages/home/index";
  const wx = {
    getStorageSync: (key) => structuredClone(storage.get(key)),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key) => storage.delete(key),
    getAppBaseInfo: () => ({ theme: "light" }),
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812 }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
    nextTick: (callback) => callback(),
    setBackgroundColor: () => {},
    showToast: () => {},
    switchTab: ({ url }) => platformCalls.push(url),
    navigateTo: ({ url, success }) => {
      platformCalls.push(url);
      success?.();
    },
    getFileSystemManager: () => {
      throw new Error("Demo calendar must not touch real cached files");
    },
    createOffscreenCanvas: ({ width, height }) => ({
      width,
      height,
      getContext: () =>
        new Proxy(
          {},
          {
            get: () => () => {},
            set: () => true,
          },
        ),
    }),
    canvasToTempFilePath: ({ success }) =>
      success({ tempFilePath: "/local/demo-calendar.png" }),
  };
  for (const name of [
    "request",
    "uploadFile",
    "downloadFile",
    "login",
    "requestPayment",
    "getRandomValues",
  ]) {
    wx[name] = (input) => {
      network.push({ name, input });
      throw new Error(`Unexpected platform call: ${name}`);
    };
  }
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    if (!compiled.has(filename)) {
      const source = fs.readFileSync(filename, "utf8");
      compiled.set(
        filename,
        filename.endsWith(".js")
          ? source
          : ts.transpileModule(source, {
              compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2020,
              },
            }).outputText,
      );
    }
    new Function(
      "module",
      "exports",
      "require",
      "wx",
      "getApp",
      "getCurrentPages",
      "Page",
      "App",
      "Date",
      compiled.get(filename),
    )(
      module,
      module.exports,
      (request) => {
        let target = path.resolve(path.dirname(filename), request);
        if (!fs.existsSync(target))
          target += fs.existsSync(`${target}.ts`) ? ".ts" : ".js";
        return load(target);
      },
      wx,
      () => (appAvailable ? app : undefined),
      () => [{ route }],
      (definition) => {
        page = definition;
      },
      (definition) => Object.assign(app, definition),
      ClockDate,
    );
    return module.exports;
  }
  app.globalData.preferences = load("store/preferences.ts").loadPreferences();
  function loadPage(relative) {
    load(relative);
    const instance = { ...page, data: structuredClone(page.data) };
    instance.setData = (patch, done) => {
      Object.assign(instance.data, structuredClone(patch));
      done?.();
    };
    return instance;
  }
  return {
    load,
    loadPage,
    storage,
    network,
    platformCalls,
    app,
    launchApp: () => {
      // WeChat can invoke initial lifecycle hooks before getApp is available.
      appAvailable = false;
      try {
        load("app.ts");
        app.onLaunch();
        app.onShow();
      } finally {
        appAvailable = true;
      }
    },
    setRoute: (value) => {
      route = value;
    },
    wx,
  };
}

function checkDemoTimetable(load, timetable) {
  const render = load("data/timetable-render.ts");
  const courses = load("data/timetable.ts").coursesForWeek(timetable, 4);
  const rows = render.buildTimetablePeriodRows(
    timetable,
    render.timetableMaxPeriod(timetable),
    courses,
  );
  assert.equal(rows.length, 12);
  for (const row of rows) {
    assert.match(row.startTime, /^\d{2}:\d{2}$/, `Period ${row.period} start`);
    assert.match(row.endTime, /^\d{2}:\d{2}$/, `Period ${row.period} end`);
    assert.ok(row.startTime < row.endTime);
  }
  const arrangements = timetable.courses.flatMap(
    (course) => course.arrangements,
  );
  assert.equal(timetable.summary.arrangementCount, arrangements.length);
  assert.ok(new Set(arrangements.map((item) => item.periodStart)).size >= 5);
  assert.deepEqual(
    [...new Set(arrangements.map((item) => item.periods.length))].sort(),
    [1, 2, 3, 4],
    "Demo classes have varied lengths",
  );
  for (let day = 1; day <= 7; day += 1) {
    const daily = arrangements.filter((item) => item.weekday === day);
    assert.ok(daily.length, `Weekday ${day} has classes`);
    const occupied = new Set();
    for (const item of daily) {
      assert.ok(item.periodStart >= 1 && item.periodEnd <= rows.length);
      assert.equal(item.startTime, rows[item.periodStart - 1].startTime);
      assert.equal(item.endTime, rows[item.periodEnd - 1].endTime);
      assert.equal(
        Math.floor((item.periodStart - 1) / 4),
        Math.floor((item.periodEnd - 1) / 4),
        "Classes do not span the lunch or dinner break",
      );
      assert.deepEqual(
        item.periods,
        Array.from(
          { length: item.periodEnd - item.periodStart + 1 },
          (_, index) => item.periodStart + index,
        ),
      );
      for (const period of item.periods) {
        assert.equal(
          occupied.has(period),
          false,
          `Day ${day} period ${period} overlaps`,
        );
        occupied.add(period);
      }
    }
  }
}

async function main() {
  const runtime = boot();
  const { load, network, storage, app } = runtime;
  const auth = load("services/auth.ts");
  const sessions = load("store/session.ts");
  const request = load("services/request.ts");
  const teaching = load("services/teaching.ts");
  const data = load("demo/data.ts");
  await assert.rejects(auth.login("demo", "bad"), /账号或密码错误/);
  assert.equal(sessions.getSession(), null);
  await auth.login(" demo ", "123456");
  assert.equal(sessions.getSession().user.account, "demo");
  assert.equal((await auth.getCurrentUser()).name, "同学");
  assert.equal((await auth.getCredentialStatus()).status, "verified");
  assert.equal(
    load("utils/identity.ts").resolveHomeIdentity(sessions.getSession(), null)
      .userName,
    "同学",
  );
  const home = runtime.loadPage("pages/home/index.ts");
  assert.equal(
    home.data.greeting,
    "晚上好",
    "Morning demo login still says good evening",
  );
  home.hydrateCachedHomeIfNeeded("demo", true);
  assert.equal(home.data.userName, "同学");
  assert.ok(home.data.todayCourses.length);
  assert.ok(home.data.plans.length);
  assert.equal(load("store/pet.ts").loadPetPreferences("demo").selected, true);
  assert.ok(
    load("store/timetable.ts").loadTimetableSnapshot("demo").data.courses
      .length,
  );
  assert.ok(
    load("store/schedule.ts")
      .loadScheduleData("demo")
      .plans.some((plan) => plan.date === data.demoDate()),
  );
  for (const fn of [
    "getTimetable",
    "getGrades",
    "getExams",
    "getMessages",
    "getNotices",
  ]) {
    const result = await teaching[fn]({});
    assert.ok((result.data.items || result.data.courses).length, fn);
  }
  const initialTimetable = (await teaching.getTimetable({})).data;
  checkDemoTimetable(load, initialTimetable);
  assert.deepEqual(
    (await teaching.getTimetable({})).data,
    initialTimetable,
    "Repeated reads keep the timetable stable",
  );
  assert.deepEqual(
    load("store/timetable.ts").loadTimetableSnapshot("demo").data.courses,
    initialTimetable.courses,
    "Cached home and timetable reads use the same arrangement",
  );
  assert.ok((await teaching.getNoticeDetail("demo-notice-0")).data.contentHtml);
  assert.equal((await teaching.getGrades({ q: "程序" })).data.items.length, 1);
  assert.equal(
    (await teaching.getExams({ page: 2, pageSize: 2 })).data.items.length,
    1,
  );
  assert.equal((await teaching.getPassRates()).data.status, "ready");
  assert.equal(
    (await teaching.getGradeClassDistribution("demo-course-0", 2026, 1)).data
      .status,
    "ready",
  );
  assert.ok((await teaching.getExamOptions()).data.semesters.length);
  assert.ok((await teaching.getRoomOptions()).data.buildings.length);
  assert.deepEqual(
    (await teaching.getRoomOptions()).data.periodGroups.flatMap(
      (group) => group.periods,
    ),
    initialTimetable.periods.map((period) => period.period),
  );
  assert.ok(
    (
      await teaching.getRooms({
        date: data.demoDate(),
        periods: [1, 2],
        campusId: "demo-campus",
        buildingIds: ["demo-building-8"],
      })
    ).data.items.length,
  );
  const calendar = await teaching.getCalendar();
  assert.equal(
    await load("features/store/calendar.ts").getCachedCalendarImage(
      calendar,
      () => teaching.downloadCalendarImage(calendar),
    ),
    "/local/demo-calendar.png",
  );

  const schedule = (await teaching.getLocalSchedule()).data;
  schedule.plans[0].done = true;
  schedule.plans.push({
    ...schedule.plans[1],
    id: "custom",
    title: "自定义计划",
  });
  await teaching.putLocalSchedule(schedule);
  assert.equal((await teaching.getLocalSchedule()).data.plans[0].done, true);
  const feedback = await load("services/feedback.ts").submitFeedback({
    type: "experience",
    content: "示例反馈",
  });
  assert.equal(feedback.content, "示例反馈");
  const electricity = load("services/electricity.ts");
  assert.ok(
    (await electricity.getElectricityAccount()).data.account
      .remainingAmountYuan > 0,
  );
  await electricity.queryElectricity({
    buildingId: "demo-dorm-2",
    buildingName: "示例宿舍2栋",
    roomNumber: "0302",
  });
  assert.equal(
    (await electricity.getElectricityAccount()).data.binding.roomNumber,
    "0302",
  );
  assert.ok(
    (await load("features/services/utilities.ts").getElectricityBuildings())
      .buildings.length,
  );
  const content = load("services/content.ts");
  const feed = await content.getPublicationFeed();
  await content.markPublicationRead(feed.items[0].id);
  await content.recordAnnouncementPopup(feed.items[0].id);
  assert.equal(
    (await content.getPublicationFeed()).unreadCount,
    feed.unreadCount - 1,
  );
  const assistant = load("features/services/course-assistant.ts");
  const catalog = await assistant.getCourseAssistantCatalog();
  assert.ok(catalog.items.length);
  const detailPages = [];
  for (const item of catalog.items) {
    const detailPage = runtime.loadPage(
      "features/pages/course-assistant-detail/index.ts",
    );
    detailPage.onLoad({ courseKey: item.courseKey });
    detailPage.onShow();
    await new Promise(setImmediate);
    assert.equal(
      detailPage.data.error,
      "",
      "Opening a demo course must succeed on the first visit without retry",
    );
    assert.equal(detailPage.data.loading, false);
    assert.equal(detailPage.data.demoAccount, true);
    assert.equal(detailPage.data.detail?.courseKey, item.courseKey);
    assert.ok(detailPage.data.detail.reviewRows.length);
    const favorites = load("features/store/course-assistant.ts");
    favorites.toggleCourseAssistantFavorite("demo", item.courseKey);
    assert.ok(
      favorites.loadCourseAssistantFavorites("demo").includes(item.courseKey),
    );
    detailPage.onUnload();
    detailPages.push(detailPage);
  }
  assert.ok((await assistant.getMyCourseAssistantData()).reviews.length);
  const course = await assistant.getCourseAssistantCourse(
    catalog.items[0].courseKey,
  );
  assert.ok(course.reviews.length);
  const review = await assistant.publishCourseAssistantReview({
    courseKey: course.courseKey,
    rating: 5,
    keywords: ["讲解清晰"],
    content: "我的示例想法",
  });
  assert.ok(
    (await assistant.getMyCourseAssistantData()).reviews.some(
      (item) => item.id === review.id,
    ),
  );
  assert.equal(
    (await assistant.toggleCourseAssistantReviewLike(review.id)).liked,
    true,
  );
  assert.equal(
    (await assistant.toggleCourseAssistantReviewLike(review.id)).liked,
    false,
  );
  const draftStore = load("store/interaction-drafts.ts");
  const publishCourseKey = catalog.items[1].courseKey;
  draftStore.saveInteractionDraft(
    "demo",
    "review",
    {
      rating: 0,
      keywords: [],
      content: "旧版留下的真心话草稿不应重新出现",
    },
    publishCourseKey,
  );
  const assistantPage = runtime.loadPage(
    "features/pages/course-assistant/index.ts",
  );
  assistantPage.onLoad({ tab: "publish", courseKey: publishCourseKey });
  assistantPage.onShow();
  await new Promise(setImmediate);
  assert.equal(assistantPage.data.demoAccount, true);
  assert.equal(assistantPage.data.reviewVisible, true);
  assert.equal(
    assistantPage.data.reviewText,
    "",
    "Ignore old demo text drafts",
  );
  assert.equal(assistantPage.data.reviewCanSubmit, false);
  assistantPage.selectRating({ currentTarget: { dataset: { rating: 5 } } });
  assert.equal(
    assistantPage.data.reviewCanSubmit,
    false,
    "Select at least one keyword",
  );
  const keywordTap = { currentTarget: { dataset: { keyword: "讲解清晰" } } };
  assistantPage.toggleReviewKeyword(keywordTap);
  assert.equal(
    assistantPage.data.reviewCanSubmit,
    true,
    "Demo can publish without text",
  );
  assistantPage.toggleReviewKeyword(keywordTap);
  assert.equal(assistantPage.data.reviewCanSubmit, false);
  assistantPage.toggleReviewKeyword(keywordTap);
  assistantPage.onReviewTextInput({
    detail: { value: "隐藏输入事件不应写入正文" },
  });
  assert.equal(assistantPage.data.reviewText, "");
  assistantPage.closeReview();
  assistantPage.openReviewFromDetail(publishCourseKey);
  assert.equal(
    assistantPage.data.reviewCanSubmit,
    true,
    "Restore the rating and keyword draft",
  );
  await assistantPage.submitReview();
  assert.equal(assistantPage.data.reviewVisible, false);
  const keywordReview = (
    await assistant.getMyCourseAssistantData()
  ).reviews.find((item) => item.courseKey === publishCourseKey);
  assert.ok(keywordReview);
  assert.equal(keywordReview.content, "");
  assert.deepEqual(
    keywordReview.keywords.map((item) => item.text),
    ["讲解清晰"],
  );
  assert.equal(
    draftStore.loadInteractionDraft("demo", "review", publishCourseKey),
    null,
  );
  assert.deepEqual(network, [], "Keyword-only publishing remains local");
  assistantPage.onUnload();
  // Existing demo users keep their local reviews when course keys are upgraded.
  const legacyStorage = new Map(
    [...storage].map(([key, value]) => [key, structuredClone(value)]),
  );
  const legacyState = legacyStorage.get("easy-swu:demo-state:v1");
  legacyState.reviews = legacyState.reviews.map((item) => {
    const index = catalog.items.findIndex(
      (course) => course.courseKey === item.courseKey,
    );
    const legacyKey = `demo-assistant-${index}`;
    return {
      ...item,
      courseKey: legacyKey,
      id: item.own ? `demo-own-${legacyKey}` : item.id,
    };
  });
  const upgraded = boot(legacyStorage);
  const upgradedAssistant = upgraded.load(
    "features/services/course-assistant.ts",
  );
  const upgradedCourse = await upgradedAssistant.getCourseAssistantCourse(
    course.courseKey,
  );
  assert.ok(
    upgradedCourse.reviews.some(
      (item) => item.own && item.content === "我的示例想法",
    ),
  );
  const upgradedDetail = upgraded.loadPage(
    "features/pages/course-assistant-detail/index.ts",
  );
  upgradedDetail.onLoad({ courseKey: course.courseKey });
  upgradedDetail.onShow();
  await new Promise(setImmediate);
  assert.equal(upgradedDetail.data.error, "");
  assert.equal(upgradedDetail.data.detail.courseKey, course.courseKey);
  await upgradedAssistant.publishCourseAssistantReview({
    courseKey: course.courseKey,
    rating: 4,
    keywords: [],
    content: "修改后的示例想法",
  });
  assert.equal(
    (await upgradedAssistant.getMyCourseAssistantData()).reviews.filter(
      (item) => item.courseKey === course.courseKey,
    ).length,
    1,
  );
  const migratedState = legacyStorage.get("easy-swu:demo-state:v1");
  assert.ok(
    migratedState.reviews.every((item) =>
      /^[a-f0-9]{64}$/.test(item.courseKey),
    ),
  );
  assert.deepEqual(migratedState.schedule, legacyState.schedule);
  assert.deepEqual(migratedState.electricity, legacyState.electricity);
  assert.deepEqual(upgraded.network, []);
  upgradedDetail.onUnload();
  load("store/pet.ts").savePetSelection("demo", {
    shape: "blob",
    color: "#111214",
    enabled: false,
  });
  await load("services/companion.ts").synchronizeCompanionPreferences(
    "demo",
    null,
  );
  assert.equal((await auth.getCurrentUser()).companion.enabled, false);
  await request.apiRequest("/auth/heartbeat", { method: "POST" });
  assert.equal(await load("services/watermark.ts").getScreenWatermark(), null);

  const dorm = load("services/auto-dorm-check.ts");
  assert.equal((await dorm.getAutoDormCheckStatus()).entryEnabled, true);
  assert.equal(
    load("data/profile-render.ts").autoDormCheckPresentationPatch({
      ...data.demoDormStatus(),
      entryEnabled: false,
    }).autoDormCheckVisible,
    true,
  );
  assert.equal(
    load("data/profile-render.ts").autoDormCheckPresentationPatch(null)
      .autoDormCheckVisible,
    true,
  );
  const navigation = load("utils/navigation.ts");
  runtime.setRoute("pages/profile/index");
  const profilePage = runtime.loadPage("pages/profile/index.ts");
  profilePage.onLoad();
  assert.equal(profilePage.data.autoDormCheckVisible, true);
  const callsBeforeDormEntry = runtime.platformCalls.length;
  profilePage.openAutoDormCheck();
  profilePage.openAutoDormCheck();
  await new Promise(setImmediate);
  assert.deepEqual(
    runtime.platformCalls.slice(callsBeforeDormEntry),
    ["/features/pages/auto-dorm-check/index"],
    "Tapping the visible demo profile entry must open dorm check exactly once",
  );
  profilePage.onUnload();

  runtime.setRoute("features/pages/auto-dorm-check/index");
  const dormPage = runtime.loadPage("features/pages/auto-dorm-check/index.ts");
  try {
    dormPage.onLoad();
    dormPage.onShow();
    await new Promise(setImmediate);
    assert.equal(dormPage.data.loaded, true);
    assert.equal(dormPage.data.loading, false);
    assert.equal(dormPage.data.errorMessage, "");
    assert.equal(dormPage.data.available, true);
    assert.equal(dormPage.data.checkInLocationName, "示例宿舍");
    assert.equal(dormPage.data.paymentEnabled, true);
    const callsBeforePayment = runtime.platformCalls.length;
    dormPage.openPayment();
    await new Promise(setImmediate);
    assert.deepEqual(runtime.platformCalls.slice(callsBeforePayment), [
      "/features/pages/auto-dorm-check-payment/index",
    ]);
  } finally {
    dormPage.onHide();
    dormPage.onUnload();
  }
  runtime.setRoute("features/pages/auto-dorm-check-payment/index");
  assert.equal(navigation.ensureAuthenticated(), true);
  assert.equal(
    (await dorm.getAutoDormCheckLocation()).locationName,
    "示例宿舍",
  );
  assert.equal((await dorm.setAutoDormCheckEnabled(false)).enabled, false);
  assert.equal((await dorm.setAutoDormCheckEnabled(true)).enabled, true);
  const demoPayment = await dorm.getAutoDormCheckPayment();
  assert.ok(demoPayment.plans.length);
  const history = await dorm.getAutoDormCheckPaymentOrders();
  assert.equal(history.items.length, 20);
  assert.equal((await dorm.getAutoDormCheckPaymentOrders(2)).items.length, 4);
  const purchase = await dorm.createAutoDormCheckPaymentOrder(
    demoPayment.plans[0].id,
    "demo-purchase",
  );
  assert.equal(purchase.order.status, "paid");
  assert.equal(purchase.payment, null);
  assert.equal(
    (await dorm.getAutoDormCheckPaymentOrders()).items[0].id,
    purchase.order.id,
  );
  assert.equal(
    (await dorm.getAutoDormCheckPaymentOrder(purchase.order.id)).order.credited,
    true,
  );
  await assert.rejects(dorm.createAutoDormCheckPaymentOrder("plan", "key"));
  assert.equal(await dorm.launchWechatPayment({}), "cancelled");
  await assert.rejects(
    request.createAuthenticatedRequestHeaders(
      "/download",
      sessions.captureSessionLease(),
    ),
  );
  for (const authenticated of [true, false]) {
    await assert.rejects(
      request.apiRequest("/future-write", { method: "POST", authenticated }),
    );
  }
  assert.deepEqual(
    network,
    [],
    "Every demo operation must stay off the network",
  );

  const realSnapshot = { keep: "real-account-cache" };
  storage.set("easy-swu:timetable:real:default", realSnapshot);
  for (const [year, month, day] of [
    [2026, 8, 9],
    [2026, 11, 31],
    [2027, 0, 1],
    [2028, 1, 29],
    [2035, 6, 15],
  ]) {
    instant = new Date(year, month, day, 23, 59).getTime();
    assert.equal(load("demo/bootstrap.ts").prepareDemoData(), true);
    const currentOrders = await dorm.getAutoDormCheckPaymentOrders();
    assert.ok(currentOrders.items.length);
    assert.ok(
      new ClockDate() - new Date(currentOrders.items[0].paidAt) < 4 * 86400000,
    );
    const timetable =
      load("store/timetable.ts").loadTimetableSnapshot("demo").data;
    assert.equal(
      timetable.semesters.length,
      1,
      "Expired demo semesters must not accumulate in the picker",
    );
    checkDemoTimetable(load, timetable);
    if (data.demoDate() === "2026-09-09") {
      assert.deepEqual(
        timetable.courses,
        initialTimetable.courses,
        "Same week stays stable across days",
      );
    } else {
      assert.notDeepEqual(
        timetable.courses,
        initialTimetable.courses,
        "Later weeks reshuffle the example classes",
      );
    }
    assert.equal(
      load("data/timetable.ts").teachingWeekForDate(timetable, new ClockDate()),
      4,
    );
    assert.ok(
      load("data/timetable.ts").coursesForDate(
        timetable,
        data.demoDate(),
        new ClockDate(),
      ).length,
      "Every day, including weekends/vacations, has classes",
    );
    assert.ok(
      load("store/schedule.ts")
        .loadScheduleData("demo")
        .plans.some((plan) => plan.date === data.demoDate() && !plan.done),
    );
    assert.ok(
      load("store/exams.ts")
        .loadExamsSnapshot("demo")
        .data.items.every((item) => Date.parse(item.time.startAt) > instant),
    );
    assert.equal(data.demoCalendar().version.includes(data.demoDate()), true);
    assert.equal(
      load("demo/bootstrap.ts").prepareDemoData(),
      false,
      "Same-day preparation preserves local edits",
    );
  }
  assert.deepEqual(
    storage.get("easy-swu:timetable:real:default"),
    realSnapshot,
  );
  const restarted = boot(storage);
  try {
    assert.doesNotThrow(
      () => restarted.launchApp(),
      "A saved demo session must cold-start before getApp becomes available",
    );
    assert.equal(restarted.app.globalData.session.user.account, "demo");
    assert.deepEqual(
      restarted.app.globalData.user,
      restarted.load("store/session.ts").loadCurrentUser(),
    );
    assert.equal(restarted.app.globalData.user.name, data.demoUser().name);
    assert.equal(restarted.app.globalData.foregroundEntryId, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(restarted.network, []);
  } finally {
    restarted.app.onHide?.();
  }
  assert.ok(
    restarted.load("store/schedule.ts").loadScheduleData("demo").plans.length,
  );
  await auth.logout();
  assert.equal(sessions.getSession(), null);
  assert.deepEqual(network, []);

  // Verify the normal session still reaches the real transport with its own token.
  sessions.saveSession({
    ...load("demo/identity.ts").demoLoginData(),
    token: "real-token",
    device: {
      id: "real-device",
      algorithm: "Ed25519",
      fingerprint: "real-fingerprint",
    },
    user: { id: "real", account: "real", name: "真实同学", companion: null },
  });
  assistantPage.applyAppearance();
  detailPages[0].applyAppearance();
  assert.equal(assistantPage.data.demoAccount, false);
  assert.equal(detailPages[0].data.demoAccount, false);
  assistantPage.prepareReview({
    ...load("demo/community.ts").demoOwnGrades()[1],
    reviewed: false,
  });
  assistantPage.selectRating({ currentTarget: { dataset: { rating: 5 } } });
  assistantPage.toggleReviewKeyword(keywordTap);
  assert.equal(
    assistantPage.data.reviewCanSubmit,
    false,
    "Normal accounts still require text",
  );
  assistantPage.onReviewTextInput({ detail: { value: "一二三四五六七" } });
  assert.equal(assistantPage.data.reviewCanSubmit, false);
  assistantPage.onReviewTextInput({ detail: { value: "一二三四五六七八" } });
  assert.equal(assistantPage.data.reviewCanSubmit, true);
  load("services/device-proof.ts").createDeviceProofHeaders = async () => ({
    "X-Test-Proof": "real",
  });
  runtime.wx.request = (input) => {
    network.push({ name: "request", input });
    input.success({
      statusCode: 200,
      data: { success: true, data: { id: "real-feedback" } },
    });
  };
  await load("services/feedback.ts").submitFeedback({
    type: "other",
    content: "normal request",
  });
  assert.equal(network.length, 1);
  assert.equal(network[0].input.header.Authorization, "Bearer real-token");
  assert.equal(load("demo/bootstrap.ts").prepareDemoData(), false);
  assert.equal(app.globalData.user, null);
  console.log(
    "Demo account checks passed: offline reads/writes, rolling dates, cache isolation, visible dorm entry and local orders.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
