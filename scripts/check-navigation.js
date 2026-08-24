const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const navigationPath = path.join(
  projectRoot,
  "miniprogram",
  "utils",
  "navigation.ts",
);
const navigationSource = fs.readFileSync(navigationPath, "utf8");
const profileSource = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "pages", "profile", "index.ts"),
  "utf8",
);
const profileTemplate = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "pages", "profile", "index.wxml"),
  "utf8",
);
const profileStyles = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "pages", "profile", "index.wxss"),
  "utf8",
);
const appStyles = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "app.wxss"),
  "utf8",
);
const quickEntryTemplates = [
  ["选课助手", "features/pages/course-assistant/index.wxml"],
  ["校园伙伴", "features/pages/pet-setup/index.wxml"],
  ["成绩展示设置", "features/pages/grade-settings/index.wxml"],
  ["个性化", "features/pages/personalization/index.wxml"],
  ["协议与隐私", "pages/legal/index.wxml"],
].map(([label, relativePath]) => ({
  label,
  source: fs.readFileSync(
    path.join(projectRoot, "miniprogram", relativePath),
    "utf8",
  ),
}));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function TypeScriptFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...TypeScriptFiles(target));
    if (entry.isFile() && entry.name.endsWith(".ts")) files.push(target);
  }
  return files;
}

function loadNavigationRuntime(navigateTo) {
  const output = ts.transpileModule(navigationSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  let timerId = 0;
  const timers = new Map();
  new Function(
    "module",
    "exports",
    "require",
    "wx",
    "getCurrentPages",
    "setTimeout",
    "clearTimeout",
    output,
  )(
    moduleRecord,
    moduleRecord.exports,
    (specifier) => {
      if (specifier === "../store/session") {
        return { getSession: () => null };
      }
      throw new Error(`Unexpected navigation dependency: ${specifier}`);
    },
    { navigateTo },
    () => [],
    (callback, delay) => {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    (id) => timers.delete(id),
  );
  return moduleRecord.exports;
}

async function main() {
  const directNavigationFiles = TypeScriptFiles(
    path.join(projectRoot, "miniprogram"),
  ).filter(
    (file) =>
      file !== navigationPath &&
      fs.readFileSync(file, "utf8").includes("wx.navigateTo("),
  );
  assert(
    directNavigationFiles.length === 0,
    `普通页面必须统一使用防重复导航：${directNavigationFiles.join(", ")}`,
  );
  assert(
    !navigationSource.includes("ORDINARY_NAVIGATION_TIMEOUT_MS"),
    "子包冷加载期间不得用短计时器提前释放导航锁并重复发起路由",
  );

  const pressedSettingRule =
    profileStyles.match(/\.setting-row--pressed\s*\{[^}]*\}/s)?.[0] || "";
  assert(
    !profileTemplate.includes('hover-class="setting-row--pressed"') &&
      (profileTemplate.match(/openingSetting ===/g) || []).length === 6 &&
      /openProfileRoute\(key: ProfileSettingKey, url: string\)[\s\S]*?if \(this\.data\.openingSetting\) return;[\s\S]*?this\.setData\(\{ openingSetting: key \}, \(\) => \{[\s\S]*?navigateTo\(url\)\.then/.test(
        profileSource,
      ) &&
      pressedSettingRule.includes(
        "background-color: var(--color-bg-subtle);",
      ) &&
      !pressedSettingRule.includes("transform") &&
      !pressedSettingRule.includes("transition"),
    "我的页面入口必须只在真实 tap 后稳定置色，再在渲染完成后发起导航",
  );
  assert(
    quickEntryTemplates.every(({ source }) =>
      source.includes("page page--quick-entry"),
    ) &&
      appStyles.includes(
        ".page--quick-entry .page-enter { animation-duration: 180ms; }",
      ) &&
      appStyles.includes(
        ".page--quick-entry .stagger-item { animation-duration: 220ms; }",
      ),
    `我的页面关联子页必须使用快速入场：${quickEntryTemplates
      .filter(({ source }) => !source.includes("page page--quick-entry"))
      .map(({ label }) => label)
      .join(", ")}`,
  );

  {
    const attempts = [];
    const navigation = loadNavigationRuntime((options) => {
      attempts.push(options);
    });
    const first = navigation.navigateTo("/features/pages/grades/index");
    const duplicate = await navigation.navigateTo(
      "/features/pages/exams/index",
    );
    assert(
      attempts.length === 1 && duplicate === false,
      "路由切换期间必须忽略连续点击，不能堆叠多个页面",
    );
    assert(
      !Object.prototype.hasOwnProperty.call(attempts[0], "routeType"),
      "普通页面必须直接使用原生导航，不得默认附加较重的转场",
    );
    attempts[0].success();
    assert(await first, "普通页面导航成功后必须正确结束请求");
    const next = navigation.navigateTo("/features/pages/exams/index");
    assert(
      attempts.length === 2,
      "导航成功后必须立即解锁，不能继续吞掉新页面上的有效点击",
    );
    attempts[1].success();
    assert(await next, "解锁后的下一次导航必须正常完成");
  }

  {
    const attempts = [];
    const navigation = loadNavigationRuntime((options) => {
      attempts.push(options);
    });
    const opened = navigation.navigateTo(
      "/features/pages/calendar/index",
      "wx://upwards",
    );
    attempts[0].fail({
      errMsg: "navigateTo:fail routeType is not supported",
    });
    assert(
      attempts.length === 2 &&
        attempts[0].routeType === "wx://upwards" &&
        !Object.prototype.hasOwnProperty.call(attempts[1], "routeType"),
      "只有明确不支持 routeType 时才能回退一次标准导航",
    );
    attempts[1].success();
    assert(await opened, "转场兼容回退成功后必须结束导航请求");
  }

  {
    const attempts = [];
    const navigation = loadNavigationRuntime((options) => {
      attempts.push(options);
    });
    const opened = navigation.navigateTo(
      "/features/pages/calendar/index",
      "wx://upwards",
    );
    attempts[0].fail({ errMsg: "navigateTo:fail page stack limit exceeded" });
    assert(
      attempts.length === 1 && (await opened) === false,
      "页面栈或切换冲突失败时不得立即叠加第二次导航",
    );
  }

  console.log("Navigation checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
