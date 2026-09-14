const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../miniprogram");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const interval = 30 * 24 * 60 * 60 * 1000;

async function main() {
  let session = "first";
  let calls = 0;
  let writes = 0;
  let request;
  let user = {
    id: "7",
    account: "student",
    name: "old",
    profile: {},
    companion: null,
  };
  const record = { exports: {} };
  const source = ts.transpileModule(read("services/profile-refresh.ts"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const stubs = {
    "../demo/identity": { isDemoAccount: (account) => account === "demo" },
    "../store/session": {
      captureSessionLease: () => ({ account: "student", key: session }),
      sessionLeaseKey: (lease) => lease.key,
      isSessionLeaseCurrent: (lease) => lease.key === session,
      loadCurrentUser: () => user,
      saveCurrentUser: (value) => {
        user = value;
        writes++;
      },
    },
    "./request": {
      apiRequest: (url, options) => {
        assert.equal(url, "/auth/profile/refresh");
        assert.equal(options.retry, false);
        assert.equal(options.credentialReauthFeedback, false);
        calls++;
        return request();
      },
    },
  };
  const now = Date.parse("2026-09-15T00:00:00Z");
  class TestDate extends Date {
    static now() {
      return now;
    }
  }
  new Function("module", "exports", "require", "Date", source)(
    record,
    record.exports,
    (name) => {
      assert.ok(stubs[name], `unexpected dependency ${name}`);
      return stubs[name];
    },
    TestDate,
  );
  const refresh = record.exports.refreshProfileOnForeground;
  user.profileFetchedAt = new Date(now - interval + 1).toISOString();
  await refresh(user);
  assert.equal(calls, 0, "less than 30 days must retain the original deadline");
  user.profileFetchedAt = new Date(now - interval).toISOString();
  let release;
  request = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = refresh(user);
  assert.equal(
    refresh(user),
    pending,
    "concurrent foreground entries reuse the request",
  );
  assert.equal(
    writes,
    0,
    "cached data remains usable while the request is pending",
  );
  user.companion = { shape: "leaf" };
  release({
    name: "new",
    profile: { grade: "2026级" },
    profileFetchedAt: new Date(now).toISOString(),
  });
  await pending;
  assert.equal(user.name, "new");
  assert.equal(user.companion.shape, "leaf");
  await refresh(user);
  assert.equal(calls, 1, "successful refresh starts the next interval");

  user.profileFetchedAt = new Date(now - (interval / 30) * 50).toISOString();
  const beforeFailure = user;
  request = async () => {
    throw new Error("offline");
  };
  assert.equal(await refresh(user), beforeFailure);
  assert.equal(
    user,
    beforeFailure,
    "failure must preserve cached data and the timestamp",
  );
  request = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const switched = refresh(user);
  session = "second";
  release({
    name: "wrong account",
    profile: {},
    profileFetchedAt: new Date(now).toISOString(),
  });
  await switched;
  assert.equal(writes, 1, "old requests cannot write after switching accounts");

  assert.match(
    read("services/primary-tab-preload.ts"),
    /state\.userPromise = getCurrentUser\(true\)/,
  );
  assert.match(
    read("services/auth.ts"),
    /saveCurrentUser\(data\);[\s\S]*if \(checkProfileFreshness\) return refreshProfileOnForeground\(data\)/,
  );
  assert.doesNotMatch(
    read("services/heartbeat.ts"),
    /refreshProfile|profile\/refresh/,
  );
  console.log(
    "Profile refresh checks passed: deadline, async cache, deduplication, failure and account isolation.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
