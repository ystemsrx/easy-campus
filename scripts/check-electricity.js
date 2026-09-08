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
      "../../../utils/haptics": {},
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
      view.data.buildingRows.flatMap((row) => row.items),
      view.data.buildings,
    );
  }
  assert.deepEqual(
    allBuildings,
    originalBuildings,
    "搜索不得修改楼栋原始名称与编号",
  );
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
