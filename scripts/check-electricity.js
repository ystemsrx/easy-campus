const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function load(relative, dependencies, globals = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, "../miniprogram", relative),
    "utf8",
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", ...Object.keys(globals), code)(
    module,
    module.exports,
    (name) => {
      assert.ok(
        Object.hasOwn(dependencies, name),
        `Unexpected dependency ${name}`,
      );
      return dependencies[name];
    },
    ...Object.values(globals),
  );
  return module.exports;
}

async function main() {
  const policy = load("store/cache-policy.ts", {});
  const electricity = load("services/electricity.ts", {
    "../store/cache-policy": policy,
    "./request": {},
  });
  assert.equal(
    electricity.isElectricityQueryResult({ cached: true, shared: true }),
    true,
  );
  assert.equal(electricity.isElectricityQueryResult({ cached: true }), false);
  assert.equal(
    electricity.isElectricityQueryResult({
      cached: true,
      shared: true,
      stale: true,
    }),
    false,
  );
  assert.equal(
    electricity.isElectricityQueryResult({
      cached: true,
      shared: true,
      deleted: true,
    }),
    false,
  );
  const old = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
  const recent = new Date().toISOString();
  const binding = { buildingId: "1", buildingName: "楼栋", roomNumber: "0305" };
  const account = {
    remainingAmountYuan: 10,
    availableElectricitySubsidyKwh: 0,
  };
  let current;
  let server;
  let response;
  let queryCount = 0;
  const lease = { account: "student" };
  const service = load("services/cache-refresh.ts", {
    "./electricity": {
      ...electricity,
      getElectricityAccount: async () => server,
      queryElectricity: async (query) => {
        assert.equal(query.automatic, true);
        assert.equal(query.roomNumber, "0305");
        queryCount += 1;
        return response;
      },
    },
    "./teaching": {},
    "../store/cache-policy": policy,
    "../store/electricity": {
      loadElectricitySnapshot: () => current,
      saveElectricitySnapshot: (_account, data, serverFetchedAt) =>
        (current = {
          data: structuredClone(data),
          serverFetchedAt,
          localStoredAt: Date.now(),
        }),
    },
    "../store/exams": {},
    "../store/session": {
      getSession: () => lease,
      captureSessionLease: () => lease,
      sessionLeaseKey: () => "student",
      isSessionLeaseCurrent: () => true,
    },
  });

  // Another roommate already refreshed: synchronize without accessing upstream.
  current = {
    data: { binding, account, accountFetchedAt: old },
    serverFetchedAt: old,
    localStoredAt: 0,
  };
  server = {
    data: {
      binding,
      account: { ...account, remainingAmountYuan: 20 },
      accountFetchedAt: recent,
    },
    meta: { cached: true, fetchedAt: recent },
  };
  await service.refreshElectricityOnForeground();
  assert.equal(queryCount, 0);
  assert.equal(current.data.account.remainingAmountYuan, 20);

  // A recent binding timestamp must not make an old room bill fresh.
  policy.beginAutomaticRefreshCycle();
  current = {
    data: { binding, account, accountFetchedAt: old },
    serverFetchedAt: recent,
    localStoredAt: Date.now(),
  };
  server = { data: current.data, meta: { cached: true, fetchedAt: recent } };
  response = {
    data: {
      binding,
      account: { ...account, remainingAmountYuan: 30 },
      accountFetchedAt: recent,
    },
    meta: { cached: true, shared: true, fetchedAt: recent },
  };
  await service.refreshElectricityOnForeground();
  assert.equal(queryCount, 1);
  assert.equal(current.data.account.remainingAmountYuan, 30);

  // Old caches without the newly introduced field refresh once, even if recent.
  policy.beginAutomaticRefreshCycle();
  current.data.account = { remainingAmountYuan: 30 };
  server = { data: current.data, meta: { cached: true, fetchedAt: recent } };
  await service.refreshElectricityOnForeground();
  assert.equal(queryCount, 2);
  assert.equal(current.data.account.availableElectricitySubsidyKwh, 0);

  // Failure and room cooldown responses must preserve the last successful bill.
  policy.beginAutomaticRefreshCycle();
  current.data.accountFetchedAt = old;
  server = { data: current.data, meta: { cached: true, fetchedAt: recent } };
  response = {
    data: { binding, account: { ...account, remainingAmountYuan: 99 } },
    meta: { cached: true, shared: true, stale: true, fetchedAt: recent },
  };
  await service.refreshElectricityOnForeground();
  assert.equal(current.data.account.remainingAmountYuan, 30);

  // Exercise the real page formatter for zero, missing and nonzero subsidies.
  let page;
  load(
    "features/pages/electricity/index.ts",
    {
      "../../../utils/app-share": { buildAppShare() {} },
      "../../../services/request": {},
      "../../../services/electricity": electricity,
      "../../services/utilities": {},
      "../../../services/cache-refresh": {},
      "../../../store/electricity": {},
      "../../../store/session": {},
      "../../../utils/appearance": { resolveAppearance: () => ({}) },
      "../../../utils/date": { formatDateTime: (value) => value },
      "../../../utils/haptics": { haptic() {} },
      "../../../utils/navigation": {},
      "../../utils/refresh-flight": {},
      "../../utils/refresh-feedback": {},
    },
    {
      Page: (value) => {
        page = value;
      },
      wx: { getWindowInfo: () => ({ windowWidth: 320 }) },
    },
  );
  const view = {
    data: {},
    setData(value) {
      Object.assign(this.data, value);
    },
  };
  const allBuildings = [
    { id: "01", name: "桃园 １舍（Ａ区）" },
    { id: "02", name: "桃园2舍(B区)" },
    { id: "Ｃ ０３", name: "竹园\u00a03舍" },
  ];
  view.data.allBuildings = allBuildings;
  const originalBuildings = structuredClone(allBuildings);
  for (const [input, cleaned, expectedIds] of [
    [" 桃 园　１ 舍（ａ 区） ", "桃园1舍(a区)", ["01"]],
    ["桃园1舍(A区)", "桃园1舍(A区)", ["01"]],
    ["桃园２舍（ｂ区）", "桃园2舍(b区)", ["02"]],
    ["竹\t园\n３ 舍", "竹园3舍", ["Ｃ ０３"]],
    [" ｃ ０３ ", "c03", ["Ｃ ０３"]],
    ["０ １", "01", ["01"]],
    ["桃 园", "桃园", ["01", "02"]],
    ["不存在", "不存在", []],
    [" \t\n　\u00a0", "", allBuildings.map((building) => building.id)],
    ["", "", allBuildings.map((building) => building.id)],
  ]) {
    const returned = page.onBuildingSearch.call(view, {
      detail: { value: input },
    });
    assert.equal(returned, cleaned, "输入框应立即显示去掉空白后的文字");
    assert.equal(view.data.buildingQuery, cleaned);
    assert.deepEqual(
      view.data.buildings.map((building) => building.id),
      expectedIds,
      `宿舍楼搜索未正确匹配：${input}`,
    );
    assert.deepEqual(
      [
        ...view.data.buildingGroups.flatMap((group) =>
          group.rows.flatMap((row) => row.items),
        ),
        ...view.data.otherBuildingRows.flatMap((row) => row.items),
      ]
        .map((building) => building.id)
        .sort(),
      expectedIds.slice().sort(),
    );
  }
  view.data.allBuildings = [
    { id: "v10", name: "李村10号" },
    { id: "g12", name: "桃园12舍（东区）" },
    { id: "other", name: "中心宿舍楼" },
    { id: "g2", name: "桃园2舍(西区)" },
    { id: "v2", name: "李村2号（新）" },
    { id: "v212", name: "李村2栋1号2单元" },
    { id: "v310", name: "李村3栋1号" },
    { id: "v220", name: "李村2栋2号" },
    { id: "v211", name: "李村2栋1号1单元" },
    { id: "v210", name: "李村2栋1号" },
    { id: "b151", name: "斑竹村151号22栋" },
    { id: "b136", name: "斑竹村136号15栋1单元" },
    { id: "b144", name: "斑竹村144号19栋" },
    { id: "b137", name: "斑竹村137号15栋2单元" },
    { id: "b146", name: "斑竹村146号" },
    { id: "s14", name: "石岗村14" },
    { id: "w18", name: "文伽村18栋" },
    { id: "store-b", name: "北区门面B" },
    { id: "doctoral-b", name: "博士生公寓B栋" },
    { id: "postdoctoral-b", name: "博士后公寓B栋" },
    { id: "store-a", name: "门面A（东）" },
    { id: "doctoral-a", name: "博士生公寓A栋（北）" },
    { id: "postdoctoral-a", name: "博士后公寓A栋" },
    { id: "g1", name: "竹园1舍" },
  ];
  page.openBuildingPicker.call(view);
  assert.deepEqual(
    view.data.buildingGroups.map((group) => group.title),
    [
      "桃园",
      "竹园",
      "博士生公寓",
      "博士后公寓",
      "斑竹村",
      "李村",
      "石岗村",
      "文伽村",
      "门面",
    ],
  );
  assert.ok(
    view.data.buildingGroups.every((group) => !group.expanded),
    "分组默认折叠",
  );
  assert.deepEqual(
    view.data.buildingGroupRows.map((row) => row.groups.map((group) => group.title)),
    [["桃园", "竹园"], ["博士生公寓", "博士后公寓"], ["斑竹村", "李村"], ["石岗村", "文伽村"], ["门面"]],
    "分组应每行两个",
  );
  assert.deepEqual(
    view.data.buildingGroups.map((group) =>
      group.rows.flatMap((row) => row.items.map((item) => item.id)),
    ),
    [
      ["g2", "g12"],
      ["g1"],
      ["doctoral-b", "doctoral-a"],
      ["postdoctoral-b", "postdoctoral-a"],
      ["b146", "b136", "b137", "b144", "b151"],
      ["v2", "v10", "v210", "v211", "v212", "v220", "v310"],
      ["s14"],
      ["w18"],
      ["store-b", "store-a"],
    ],
  );
  assert.deepEqual(
    view.data.otherBuildingRows.flatMap((row) =>
      row.items.map((item) => item.id),
    ),
    ["other"],
  );
  assert.equal(
    view.data.buildingGroups[0].rows[0].items[0].name,
    "桃园2舍(西区)",
  );
  page.toggleBuildingGroup.call(view, {
    currentTarget: { dataset: { id: "garden:桃园" } },
  });
  assert.equal(view.data.buildingGroups[0].expanded, true);
  assert.equal(view.data.buildingGroups[1].expanded, false);
  view.data.motionClass = "motion-normal";
  page.toggleBuildingGroup.call(view, {
    currentTarget: { dataset: { id: "garden:竹园" } },
  });
  assert.equal(view.data.buildingGroups[0].expanded, false, "同排先收起原分组");
  assert.equal(view.data.buildingGroups[1].expanded, false, "同排等待收起后再展开");
  page.toggleBuildingGroup.call(view, {
    currentTarget: { dataset: { id: "garden:竹园" } },
  });
  assert.equal(view.data.buildingGroups[1].expanded, false, "连续点击不应跳过收起动画");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(view.data.buildingGroups[1].expanded, true);
  page.toggleBuildingGroup.call(view, {
    currentTarget: { dataset: { id: "doctoral:博士生公寓" } },
  });
  assert.equal(view.data.buildingGroups[1].expanded, true, "不同行可同时展开");
  assert.equal(view.data.buildingGroups[2].expanded, true);
  page.onBuildingSearch.call(view, { detail: { value: "桃园12" } });
  assert.equal(
    view.data.buildingGroups[0].expanded,
    true,
    "搜索结果应可直接选择",
  );
  assert.deepEqual(
    allBuildings,
    originalBuildings,
    "搜索不得修改楼栋原始名称与编号",
  );
  view.data.buildingId = "g2";
  page.openBuildingPicker.call(view);
  assert.equal(view.data.buildingGroups[0].expanded, true, "再次打开应展开已选宿舍楼所在组");
  assert.equal(view.data.buildingGroups[1].expanded, false);
  for (const [subsidy, expected] of [
    [0, "0.00 度"],
    [119.29, "119.29 度"],
    [null, "暂无记录"],
    [undefined, "暂无记录"],
  ]) {
    page.applyElectricityData.call(view, {
      binding,
      account: {
        billedElectricityKwh: 1,
        electricityFeeYuan: 1,
        remainingAmountYuan: 1,
        availableElectricitySubsidyKwh: subsidy,
      },
      accountFetchedAt: recent,
    });
    assert.equal(view.data.account.availableElectricitySubsidyLabel, expected);
  }
  const template = fs.readFileSync(
    path.join(
      __dirname,
      "../miniprogram/features/pages/electricity/index.wxml",
    ),
    "utf8",
  );
  const card = template.slice(
    template.indexOf('<view class="date-card card">'),
  );
  assert.ok(card.indexOf("可用电补助") < card.indexOf("上次缴费日期"));
  assert.ok(card.indexOf("上次缴费日期") < card.indexOf("最后结算日期"));
  console.log("电费寝室共享、刷新时间、旧缓存、补助显示和楼栋搜索检查通过");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
