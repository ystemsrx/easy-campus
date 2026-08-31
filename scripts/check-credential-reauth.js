const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "services", "request.ts"),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const session = {
  token: "local-token",
  tokenType: "Bearer",
  sliding: true,
  signedInAt: 1,
  device: { id: "device-1", algorithm: "Ed25519" },
  credential: { status: "invalid", checkedAt: null, errorCode: null },
  user: { id: "7", account: "202500000000001", name: "测试用户" },
};
const lease = {
  token: session.token,
  userId: session.user.id,
  account: session.user.account,
  signedInAt: session.signedInAt,
};
let requestCalls = 0;
let sessionClears = 0;
let nextError = null;
const toastMessages = [];

const sessionStore = {
  captureSessionLease: () => lease,
  clearSession: () => {
    sessionClears += 1;
  },
  clearSessionIfCurrent: () => {
    sessionClears += 1;
    return true;
  },
  getSession: () => session,
  isSessionLeaseCurrent: () => true,
  queueAccountDeactivatedNotice: () => undefined,
  sessionLeaseKey: () => "lease",
  updateSessionCredential: (credential) => {
    session.credential = credential;
  },
  updateSessionDevice: () => session,
};

const moduleRecord = { exports: {} };
new Function(
  "module",
  "exports",
  "require",
  "wx",
  "getApp",
  "getCurrentPages",
  compiled,
)(
  moduleRecord,
  moduleRecord.exports,
  (specifier) => {
    if (specifier === "../config/index") {
      return { getApiUrl: (value) => value };
    }
    if (specifier === "../store/session") return sessionStore;
    if (specifier === "../utils/navigation") return { goToLogin() {} };
    if (specifier === "./device-proof") {
      return {
        canonicalRequestTarget: (value) => value,
        createDeviceProofHeaders: async () => ({}),
        getDevicePublicKey: async () => "public-key",
        hashRequestData: () => "body-hash",
      };
    }
    throw new Error(`Unexpected request dependency: ${specifier}`);
  },
  {
    request(options) {
      requestCalls += 1;
      if (nextError) {
        const error = nextError;
        nextError = null;
        options.success({
          statusCode: error.statusCode,
          data: {
            success: false,
            error: {
              code: error.code,
              message: error.message,
            },
          },
        });
        return;
      }
      options.success({
        statusCode: 200,
        data: { success: true, data: { alive: true } },
      });
    },
    showToast({ title }) {
      toastMessages.push(title);
    },
  },
  () => ({ globalData: { session } }),
  () => [
    {
      selectComponent() {
        return {
          show(message) {
            toastMessages.push(message);
          },
        };
      },
    },
  ],
);

const {
  ApiClientError,
  apiRequest,
  CREDENTIAL_REAUTH_REQUIRED_CODE,
  getErrorMessage,
  shouldShowRefreshFailureFeedback,
} = moduleRecord.exports;

void (async () => {
  await assert.rejects(
    apiRequest("/automatic-refresh"),
    (error) => error.code === CREDENTIAL_REAUTH_REQUIRED_CODE,
  );
  assert.equal(requestCalls, 0);
  assert.deepEqual(toastMessages, []);

  await assert.rejects(
    apiRequest("/manual-refresh", { credentialReauthFeedback: true }),
    (error) => error.code === CREDENTIAL_REAUTH_REQUIRED_CODE,
  );
  assert.equal(requestCalls, 0);
  assert.deepEqual(toastMessages, ["验证失败，请重新登录小程序"]);
  assert.equal(sessionClears, 0);

  await apiRequest("/auth/heartbeat", { allowInvalidCredential: true });
  assert.equal(requestCalls, 1);
  assert.equal(sessionClears, 0);

  session.credential.status = "valid";
  nextError = {
    statusCode: 409,
    code: "SWU_CREDENTIAL_REAUTH_REQUIRED",
    message: "验证失败，请重新登录小程序",
  };
  await assert.rejects(
    apiRequest("/first-manual-refresh", {
      credentialReauthFeedback: true,
    }),
    (error) => error.code === CREDENTIAL_REAUTH_REQUIRED_CODE,
  );
  assert.equal(requestCalls, 2);
  assert.deepEqual(toastMessages, [
    "验证失败，请重新登录小程序",
    "验证失败，请重新登录小程序",
  ]);
  assert.equal(sessionClears, 0);
  assert.equal(session.credential.status, "invalid");

  session.credential.status = "valid";
  nextError = {
    statusCode: 403,
    code: "SWU_ACCOUNT_LOCKED",
    message: "账号异常，请联系学校",
  };
  await assert.rejects(
    apiRequest("/locked-account-refresh", {
      credentialReauthFeedback: true,
    }),
    (error) => error.code === CREDENTIAL_REAUTH_REQUIRED_CODE,
  );
  assert.equal(session.credential.status, "invalid");
  assert.equal(session.credential.errorCode, "SWU_ACCOUNT_LOCKED");
  assert.deepEqual(toastMessages, [
    "验证失败，请重新登录小程序",
    "验证失败，请重新登录小程序",
    "验证失败，请重新登录小程序",
  ]);

  session.credential.status = "valid";
  nextError = {
    statusCode: 403,
    code: "SWU_PASSWORD_EXPIRED",
    message: "密码已过期，请到学校官网修改密码",
  };
  await assert.rejects(
    apiRequest("/expired-password-automatic-refresh"),
    (error) => error.code === CREDENTIAL_REAUTH_REQUIRED_CODE,
  );
  assert.equal(session.credential.status, "invalid");
  assert.equal(session.credential.errorCode, "SWU_PASSWORD_EXPIRED");
  assert.equal(toastMessages.length, 3);
  assert.equal(sessionClears, 0);

  nextError = {
    statusCode: 401,
    code: "SWU_AUTH_FAILED",
    message: "账号或密码错误",
  };
  let loginError;
  try {
    await apiRequest("/auth/login", {
      authenticated: false,
      method: "POST",
      data: { account: "202500000000001", password: "wrong-password" },
    });
  } catch (error) {
    loginError = error;
  }
  assert.equal(loginError.code, "SWU_AUTH_FAILED");
  assert.equal(getErrorMessage(loginError), "账号或密码错误");
  assert.equal(session.credential.errorCode, "SWU_PASSWORD_EXPIRED");
  assert.equal(toastMessages.length, 3);

  assert.equal(
    shouldShowRefreshFailureFeedback(
      new ApiClientError({
        code: "UPSTREAM_UNAVAILABLE",
        message: "upstream unavailable",
        statusCode: 503,
      }),
    ),
    true,
  );
  assert.equal(
    shouldShowRefreshFailureFeedback(
      new ApiClientError({
        code: CREDENTIAL_REAUTH_REQUIRED_CODE,
        message: "reauth required",
        statusCode: 409,
      }),
    ),
    false,
  );
  assert.equal(
    shouldShowRefreshFailureFeedback(
      new ApiClientError({
        code: "RATE_LIMITED",
        message: "rate limited",
        statusCode: 429,
      }),
    ),
    false,
  );

  console.log("Credential reauthentication feedback checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
