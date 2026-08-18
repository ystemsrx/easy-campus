const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadTypeScriptModule(relativePath) {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "miniprogram", relativePath),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("module", "exports", "require", output)(
    moduleRecord,
    moduleRecord.exports,
    require,
  );
  return moduleRecord.exports;
}

const { resolveHomeIdentity } = loadTypeScriptModule("utils/identity.ts");
const session = {
  user: { id: "7", account: "22200000", name: "林一" },
};

assert(
  resolveHomeIdentity(session, null).userName === "林一",
  "首页首屏必须直接使用登录响应中的姓名",
);
assert(
  resolveHomeIdentity(session, {
    account: "22200000",
    name: "林一",
    profile: { name: "林一一", organizationName: "西南大学计算机学院" },
  }).userName === "林一一",
  "首页必须优先使用同一账号的完整用户资料姓名",
);
assert(
  resolveHomeIdentity(session, {
    account: "33300000",
    name: "其他用户",
    profile: { name: "其他用户" },
  }).userName === "林一",
  "首页不得串用其他账号的本地用户资料",
);
assert(
  resolveHomeIdentity(
    { user: { id: "7", account: "22200000", name: "同学" } },
    null,
  ).userName === "22200000",
  "首页不得回退显示通用的“同学”占位",
);

const homeScript = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "pages", "home", "index.ts"),
  "utf8",
);
const homeTemplate = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "pages", "home", "index.wxml"),
  "utf8",
);
const homeStyles = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "pages", "home", "index.wxss"),
  "utf8",
);

assert(
  /onLoad\(\)[\s\S]*?this\.hydrateIdentity\(\)/.test(homeScript) &&
    /onShow\(\)[\s\S]*?this\.hydrateIdentity\(\)/.test(homeScript),
  "首页进入和再次显示时都必须同步恢复用户姓名",
);
assert(
  homeStyles.includes(
    ".welcome-name { display: block; flex: 1; min-width: 0;",
  ) && !homeStyles.includes("max-width: 240rpx"),
  "首页姓名必须使用剩余标题宽度，避免较长姓名被固定宽度截断",
);

assert(
  homeScript.includes("const HOME_PREVIEW_ITEM_LIMIT = 3;") &&
    /const messages = \(cached\?\.messages \|\| \[\]\)[\s\S]*?\.slice\(0, HOME_PREVIEW_ITEM_LIMIT\)[\s\S]*?\.map\(toMessagePreview\)/.test(
      homeScript,
    ) &&
    /const notices = \(cached\?\.notices \|\| \[\]\)[\s\S]*?\.slice\(0, HOME_PREVIEW_ITEM_LIMIT\)[\s\S]*?\.map\(toNoticePreview\)/.test(
      homeScript,
    ),
  "首页从本地教学缓存恢复时，消息和通知预览都必须限制为 3 条",
);

assert(
  homeTemplate.indexOf(">教务消息</text>") <
    homeTemplate.indexOf(">学校通知</text>") &&
    /教务消息<\/text>[\s\S]*?openMessagesFromCard[\s\S]*?学校通知<\/text>[\s\S]*?openNoticesFromCard/.test(
      homeTemplate,
    ),
  "首页校园消息必须先展示教务消息，再展示学校通知，并保持卡片跳转一致",
);

assert(
  /const gradeRequest = includeStableData[\s\S]*?getGrades\([\s\S]*?\.then\(\(result\) => \{[\s\S]*?this\.hydrateServerGrade\(account, result, refresh\)/.test(
    homeScript,
  ) &&
    /hydrateServerGrade\([\s\S]*?saveGradesSnapshot\([\s\S]*?this\.setData\([\s\S]*?gradePreviewPatch\(/.test(
      homeScript,
    ),
  "首页必须在服务器成绩快照返回时立即缓存并渲染，不能等待其他首页请求",
);

assert(
  homeTemplate.includes("publication-popover--empty") &&
    /\.publication-popover \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*height: 62vh;[^}]*\}/.test(
      homeStyles,
    ) &&
    /\.publication-popover--empty \{[^}]*height: 400rpx;[^}]*min-height: 400rpx;[^}]*\}/.test(
      homeStyles,
    ) &&
    /\.publication-popover-scroll \{[^}]*flex: 1;[^}]*height: 0;[^}]*min-height: 0;[^}]*\}/.test(
      homeStyles,
    ),
  "首页消息弹窗必须给列表明确高度，并在无内容时保留空状态区域",
);

console.log("Home cache and identity checks passed.");
