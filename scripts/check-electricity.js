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
  console.log("电费寝室共享、刷新时间、旧缓存和补助显示检查通过");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
