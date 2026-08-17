const fs = require("node:fs");
const path = require("node:path");

const miniprogramRoot = path.resolve(__dirname, "..", "miniprogram");
const failures = [];
const appConfig = JSON.parse(
  fs.readFileSync(path.join(miniprogramRoot, "app.json"), "utf8"),
);

for (const page of appConfig.pages || []) {
  const configPath = path.join(miniprogramRoot, `${page}.json`);
  if (!fs.existsSync(configPath)) {
    failures.push(`${page}.json: 页面配置不存在`);
    continue;
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (config.navigationStyle !== "custom" || config.disableScroll !== true) {
    failures.push(
      `${page}.json: Skyline 页面必须使用自定义导航栏并禁用页面级滚动`,
    );
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkBalancedTags(source, relativePath) {
  const stack = [];
  const tagPattern = /<!--[\s\S]*?-->|<\/?([A-Za-z][\w-]*)\b[^>]*>/g;
  let match;
  while ((match = tagPattern.exec(source))) {
    if (!match[1] || match[0].startsWith("<!--") || match[0].endsWith("/>")) {
      continue;
    }
    const tag = match[1];
    if (match[0].startsWith("</")) {
      const expected = stack.pop();
      if (expected !== tag) {
        failures.push(
          `${relativePath}: 标签闭合错误，期望 </${expected || "空"}>，实际 </${tag}>`,
        );
        return;
      }
    } else {
      stack.push(tag);
    }
  }
  if (stack.length) {
    failures.push(`${relativePath}: 标签 <${stack[stack.length - 1]}> 未闭合`);
  }
}

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(fullPath);
      continue;
    }

    if (!entry.name.endsWith(".wxml")) {
      continue;
    }

    const source = fs.readFileSync(fullPath, "utf8");
    const relativePath = path.relative(miniprogramRoot, fullPath);
    const scrollViews = source.match(/<scroll-view\b[^>]*>/g) || [];
    for (const tag of scrollViews) {
      if (!/\btype=(?:"[^"]+"|'[^']+'|"\{\{[^}]+\}\}")/.test(tag)) {
        failures.push(
          `${relativePath}: scroll-view 缺少 Skyline 必需的 type 属性`,
        );
      }
      if (
        /\bscroll-x(?:\s|=|>)/.test(tag) &&
        !/\benable-flex(?:\s|=|>)/.test(tag)
      ) {
        failures.push(`${relativePath}: 横向 scroll-view 缺少 enable-flex`);
      }
    }

    if (/<web-view\b/.test(source)) {
      failures.push(`${relativePath}: Skyline 不支持 web-view`);
    }

    const scriptPath = fullPath.replace(/\.wxml$/, ".ts");
    const script = fs.existsSync(scriptPath)
      ? fs.readFileSync(scriptPath, "utf8")
      : "";
    const eventPattern =
      /\b(?:bind|catch|capture-bind|capture-catch)[\w:-]*=(['"])([^'"{}]+)\1/g;
    let eventMatch;
    while ((eventMatch = eventPattern.exec(source))) {
      const handler = eventMatch[2];
      if (!new RegExp(`\\b${escapeRegExp(handler)}\\s*\\(`).test(script)) {
        failures.push(
          `${relativePath}: 事件处理函数 ${handler} 未在同名 TypeScript 文件中定义`,
        );
      }
    }

    checkBalancedTags(source, relativePath);
  }
}

visit(miniprogramRoot);

const navigationTemplate = fs.readFileSync(
  path.join(
    miniprogramRoot,
    "components",
    "navigation-bar",
    "navigation-bar.wxml",
  ),
  "utf8",
);
const navigationStyles = fs.readFileSync(
  path.join(
    miniprogramRoot,
    "components",
    "navigation-bar",
    "navigation-bar.wxss",
  ),
  "utf8",
);
const navigationScript = fs.readFileSync(
  path.join(
    miniprogramRoot,
    "components",
    "navigation-bar",
    "navigation-bar.ts",
  ),
  "utf8",
);
const pageNavigationSources = (appConfig.pages || [])
  .flatMap((page) => [`${page}.wxml`, `${page}.ts`])
  .map((page) => fs.readFileSync(path.join(miniprogramRoot, page), "utf8"))
  .join("\n");
if (
  !navigationTemplate.startsWith(
    '<view class="nav-cover nav-cover--{{theme}}" style="height: {{coverHeight}}px;"></view>\n<view class="nav-spacer" style="height: {{totalHeight}}px;"></view>\n<view\n  class="nav-shell',
  ) ||
  !navigationTemplate.includes(
    'class="nav-content" style="top: {{controlTop}}px; height: {{contentHeight}}px;"',
  ) ||
  !navigationTemplate.includes('style="top: -{{backLift}}px;"') ||
  navigationTemplate.includes("backOffset") ||
  navigationTemplate.includes("scrolled") ||
  navigationScript.includes("scrolled") ||
  navigationScript.includes("backOffset") ||
  !navigationScript.includes(
    'insetBack: { type: Boolean, value: false }',
  ) ||
  !navigationScript.includes("const NAVIGATION_INSET_RPX = 28") ||
  !navigationScript.includes(
    "(NAVIGATION_INSET_RPX * windowInfo.windowWidth) / 750",
  ) ||
  !navigationScript.includes(
    "controlTop + (contentHeight - backButtonSize) / 2",
  ) ||
  !navigationScript.includes(
    "naturalBackTop - navigationInset",
  ) ||
  !navigationScript.includes("backLift,") ||
  !navigationScript.includes("const controlTop = menu.top") ||
  !navigationScript.includes(
    "const nativeControlBottom = menu.bottom",
  ) ||
  !navigationScript.includes(
    "const insetBack = this.data.back && this.data.insetBack",
  ) ||
  !navigationScript.includes(
    "const coverHeight = insetBack",
  ) ||
  !navigationScript.includes(
    ": nativeControlBottom",
  ) ||
  !navigationScript.includes("const backLift = insetBack") ||
  !navigationScript.includes(
    "totalHeight: coverHeight",
  ) ||
  pageNavigationSources.includes("headerScrolled") ||
  !navigationStyles.includes(
    ".nav-cover {\n  position: fixed;\n  top: 0;\n  right: 0;\n  left: 0;\n  z-index: 700;",
  ) ||
  !navigationStyles.includes("pointer-events: none;") ||
  !navigationStyles.includes(
    ".nav-spacer {\n  flex: none;\n  width: 100%;",
  ) ||
  !navigationStyles.includes(
    ".nav-shell {\n  position: fixed;\n  top: 0;\n  right: 0;\n  left: 0;\n  z-index: 800;",
  ) ||
  !navigationStyles.includes(".nav-content {\n  position: absolute;")
) {
  failures.push(
    "components/navigation-bar: 顶部窄遮罩与固定导航操作层必须按原生胶囊位置对齐，且不得触发滚动状态重绘",
  );
}

const inboxTemplate = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "inbox", "index.wxml"),
  "utf8",
);
const inboxStyles = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "inbox", "index.wxss"),
  "utf8",
);
if (
  !inboxStyles.includes(
    ".inbox-toolbar { flex: none; padding: 28rpx 48rpx 10rpx;",
  )
) {
  failures.push(
    "pages/inbox/index.wxss: 消息选择器必须与顶部原生胶囊保留明确间距",
  );
}
if (
  (
    inboxTemplate.match(
      /refresher-default-style="\{\{theme === 'dark' \? 'white' : 'black'\}\}"/g,
    ) || []
  ).length !== 2 ||
  /slot="refresher"/.test(inboxTemplate)
) {
  failures.push(
    "pages/inbox/index.wxml: 两个消息列表必须使用原生黑白刷新指示器，不得回退到缺失的自定义 refresher",
  );
}
if (
  inboxTemplate.includes("<root-portal") ||
  !inboxTemplate.includes('bindtap="onPageTap"') ||
  !inboxTemplate.includes('catchtap="openMessageFilter"') ||
  !inboxTemplate.includes('<view class="message-filter-anchor">') ||
  !inboxTemplate.includes('data-index="{{index}}"') ||
  !inboxTemplate.includes('catchtap="selectMessageType"')
) {
  failures.push(
    "pages/inbox/index.wxml: 消息筛选必须与触发按钮位于同一 Skyline 层，并以稳定索引直接触发勾选状态",
  );
}

const homeTemplate = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "home", "index.wxml"),
  "utf8",
);
const electricityTemplate = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "electricity", "index.wxml"),
  "utf8",
);
const electricityScript = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "electricity", "index.ts"),
  "utf8",
);
const passRateTemplate = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "pass-rates", "index.wxml"),
  "utf8",
);
const passRateScript = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "pass-rates", "index.ts"),
  "utf8",
);
const passRateStyles = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "pass-rates", "index.wxss"),
  "utf8",
);
if (
  !homeTemplate.includes('class="feature-open-container"') ||
  !homeTemplate.includes('bind:tap="openElectricity"') ||
  !electricityTemplate.includes('title="宿舍用电与余额"')
) {
  failures.push(
    "pages/home/index.wxml: 寝室电费必须使用与课表一致的卡片放大转场，并保留完整页面标题",
  );
}
if (
  !electricityTemplate.includes("<bottom-sheet") ||
  !electricityTemplate.includes('expanded="{{true}}"') ||
  !electricityTemplate.includes('scrollable="{{false}}"') ||
  !electricityTemplate.includes('class="building-picker-scroll"')
) {
  failures.push(
    "pages/electricity/index.wxml: 宿舍楼选择必须使用展开式底部抽屉及独立列表滚动区",
  );
}
if (
  !electricityTemplate.includes("{{querying ? '读取中' : '绑定'}}") ||
  !electricityTemplate.includes('class="result-action result-action--icon') ||
  electricityTemplate.includes("<text>刷新</text>") ||
  !electricityTemplate.includes("{{boundBuildingName}}") ||
  !electricityTemplate.includes("{{boundRoomNumber}}") ||
  electricityTemplate.includes("refresher-") ||
  !electricityScript.includes("isBindingCooldownActive(") ||
  !electricityScript.includes("serverBindingCleared") ||
  !electricityScript.includes("this.data.boundBuildingId")
) {
  failures.push(
    "pages/electricity: 换绑草稿必须与当前绑定分离，并保留紧凑的读取、换绑和刷新状态",
  );
}

if (
  passRateTemplate.includes("<bottom-sheet") ||
  !passRateTemplate.includes('class="pass-picker-layer"') ||
  !passRateTemplate.includes('class="semester-menu"') ||
  passRateTemplate.includes('class="semester-menu-scroll"') ||
  !passRateTemplate.includes('class="course-picker-body"') ||
  !passRateTemplate.includes('class="course-picker-scroll" type="list"') ||
  !passRateTemplate.includes('class="course-picker-content"') ||
  !passRateTemplate.includes('class="course-picker-bottom-space"') ||
  !passRateTemplate.includes(
    'wx:for="{{courseRows}}" wx:key="id" wx:for-item="row"',
  ) ||
  passRateTemplate.includes('scroll-into-view="{{coursePickerTarget}}"') ||
  !passRateTemplate.includes('({{item.courses.length}})') ||
  passRateTemplate.includes("back-offset") ||
  !passRateTemplate.includes('inset-back="{{true}}"') ||
  !passRateScript.includes("function toCourseRows(") ||
  !passRateScript.includes("function coursePickerState(") ||
  !passRateScript.includes('shortAcademicSemesterLabel(') ||
  !passRateScript.includes(
    "coursePickerState(groups, this.data.selectedSemesterId)",
  ) ||
  !passRateStyles.includes(
    ".course-picker-body { flex: 1; width: 100%; min-height: 0; }",
  ) ||
  !passRateStyles.includes(
    ".course-picker-scroll { width: 100%; height: 100%; background: #fbf9f4; }",
  ) ||
  !passRateStyles.includes(
    ".course-picker-bottom-space { width: 100%; height: calc(136rpx + env(safe-area-inset-bottom)); }",
  ) ||
  !passRateStyles.includes(
    ".course-picker-list-row { display: flex; flex: none; flex-direction: row; box-sizing: border-box; width: 100%; height: 88rpx; padding-bottom: 12rpx; }",
  )
) {
  failures.push(
    "pages/pass-rates: 课程选择必须与校园消息一致，在同一模板中使用明确高度的滚动区、内容层和底部占位",
  );
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("WXML Skyline checks passed.");
}
