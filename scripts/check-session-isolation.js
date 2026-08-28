const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..", "miniprogram");
const failures = [];

function source(...segments) {
  return fs.readFileSync(path.join(root, ...segments), "utf8");
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const sessionSource = source("store", "session.ts");
const compiledSession = ts.transpileModule(sessionSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const sessionModule = { exports: {} };
new Function("exports", "module", compiledSession)(
  sessionModule.exports,
  sessionModule,
);
const { captureSessionLease, isSessionLeaseCurrent, sessionLeaseKey } =
  sessionModule.exports;

const sessionA = {
  token: "token-a",
  tokenType: "Bearer",
  sliding: true,
  signedInAt: 100,
  user: { id: "user-a", account: "20260001", name: "A" },
};
const leaseA = captureSessionLease(sessionA);
assert(isSessionLeaseCurrent(leaseA, sessionA), "原会话必须匹配自己的 lease");
assert(
  !isSessionLeaseCurrent(leaseA, {
    ...sessionA,
    token: "token-b",
    signedInAt: 101,
    user: { id: "user-b", account: "20260002", name: "B" },
  }),
  "切换账号后旧 lease 必须失效",
);
assert(
  !isSessionLeaseCurrent(leaseA, {
    ...sessionA,
    token: "token-a-new",
    signedInAt: 101,
  }),
  "同一账号重新登录后旧 lease 必须失效",
);
assert(
  sessionLeaseKey(leaseA) !==
    sessionLeaseKey({ ...leaseA, token: "token-a-new" }),
  "请求去重键必须区分同账号同毫秒产生的新 token",
);

const previousWx = global.wx;
const localStorage = new Map([
  [
    "easy-swu:user",
    {
      id: "user-a",
      account: "20260001",
      name: "A",
      credential: { status: "verified", checkedAt: null, errorCode: null },
      companion: null,
      profile: {
        gender: "男",
        grade: "2026级",
        organizationName: "测试学院",
        className: "测试1班",
        enrollmentDate: "2026-09-01",
        majorName: "不应保留在客户端",
        registeredPhone: "13000000000",
      },
    },
  ],
]);
global.wx = {
  getStorageSync(key) {
    return localStorage.get(key);
  },
  setStorageSync(key, value) {
    localStorage.set(key, value);
  },
};
const sanitizedUser = sessionModule.exports.loadCurrentUser();
assert(
  sanitizedUser?.profile.gender === "男" &&
    !("majorName" in sanitizedUser.profile) &&
    !("registeredPhone" in sanitizedUser.profile) &&
    !("majorName" in localStorage.get("easy-swu:user").profile),
  "旧版用户缓存必须在读取时裁剪为资料卡实际使用的字段",
);
global.wx = previousWx;

const requestSource = source("services", "request.ts");
assert(
  requestSource.includes("const context = createRequestContext(options)") &&
    requestSource.includes(
      "requestOnce<T>(path, { ...options, retry: false }, context)",
    ),
  "首次请求与重试必须共用同一不可变请求上下文",
);
assert(
  requestSource.includes("Authorization: `Bearer ${lease.token}`") &&
    !requestSource.includes("Authorization: `Bearer ${session.token}`"),
  "认证头必须固定使用请求开始时捕获的 token",
);
assert(
  requestSource.includes(
    "if (authenticated && !isSessionLeaseCurrent(lease))",
  ) && requestSource.includes("clearSessionIfCurrent(lease)"),
  "旧响应必须在解析前失效，且只能清理自己发起时的会话",
);
assert(
  requestSource.includes("if (!getSession()) goToLogin()"),
  "认证失败的延迟导航不得把刚登录的新会话送回登录页",
);
assert(
  /const AUTH_ERROR_CODES = new Set\(\[[\s\S]*?"SWU_SESSION_INVALIDATED"[\s\S]*?\]\)/.test(
    requestSource,
  ),
  "普通请求收到 SWU_SESSION_INVALIDATED 时必须清理当前会话并返回登录页",
);
assert(
  sessionSource.includes("wx.removeStorageSync(SESSION_INVALID_NOTICE_KEY)") &&
    sessionSource.includes(
      "wx.removeStorageSync(ACCOUNT_DEACTIVATED_NOTICE_KEY)",
    ),
  "新登录必须清除旧会话留下的认证提示",
);

const authSource = source("services", "auth.ts");
const loginPageSource = source("pages", "login", "index.ts");
const companionSource = source("services", "companion.ts");
const teachingSource = source("services", "teaching.ts");
const contentSource = source("services", "content.ts");
assert(
  authSource.includes("clearSessionIfCurrent(lease)") &&
    authSource.includes("assertSessionLeaseCurrent(lease)"),
  "退出、用户资料及凭据状态写入必须受会话 lease 保护",
);
assert(
  authSource.includes("revision !== loginRequestRevision") &&
    loginPageSource.includes("cancelPendingLogin()"),
  "登录响应必须受请求世代保护，页面卸载后不得反向覆盖新会话",
);
assert(
  companionSource.includes("lease.account !== account") &&
    companionSource.includes("isSessionLeaseCurrent(lease)"),
  "伙伴偏好同步必须绑定目标账号和会话",
);
assert(
  teachingSource.includes("isSessionLeaseCurrent(lease)") &&
    contentSource.includes("const cacheKey = `${lease.userId}:${media.id}`"),
  "自定义下载和媒体缓存必须隔离账号",
);

const guardedPages = [
  ["pages", "home", "index.ts"],
  ["pages", "schedule", "index.ts"],
  ["pages", "profile", "index.ts"],
  ["features", "pages", "grades", "index.ts"],
  ["features", "pages", "exams", "index.ts"],
  ["features", "pages", "inbox", "index.ts"],
  ["features", "pages", "electricity", "index.ts"],
  ["features", "pages", "timetable", "index.ts"],
];
for (const segments of guardedPages) {
  const pageSource = source(...segments);
  assert(
    pageSource.includes("captureSessionLease") &&
      pageSource.includes("isSessionLeaseCurrent"),
    `${segments.join("/")} 的异步页面写入必须校验会话 lease`,
  );
}

const profileSource = source("pages", "profile", "index.ts");
const inboxSource = source("features", "pages", "inbox", "index.ts");
const electricitySource = source(
  "features",
  "pages",
  "electricity",
  "index.ts",
);
const timetableSource = source("features", "pages", "timetable", "index.ts");
assert(
  profileSource.includes("activeProfileSessionKey") &&
    profileSource.includes("loading: false"),
  "个人页换会话时必须解除旧请求留下的 loading 锁",
);
assert(
  inboxSource.includes("messageRequestSequence += 1") &&
    inboxSource.includes("messageLoading: false"),
  "消息页换账号时必须取消旧请求并解除列表忙锁",
);
assert(
  electricitySource.includes("bindingEditing: false") &&
    electricitySource.includes('roomNumber: ""'),
  "电费页换账号时必须清空旧账号的换绑草稿",
);
assert(
  timetableSource.includes("visibleCourses = []") &&
    timetableSource.includes("weekPages: []") &&
    timetableSource.includes("selectedCourse: null"),
  "课表页换账号且无快照时必须清空旧账号课程与详情",
);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Session isolation checks passed.");
}
