const fs = require("node:fs");
const path = require("node:path");

const miniprogramRoot = path.resolve(__dirname, "..", "miniprogram");
const failures = [];
const appConfig = JSON.parse(
  fs.readFileSync(path.join(miniprogramRoot, "app.json"), "utf8"),
);
const skylineOptions = appConfig.rendererOptions?.skyline || {};
for (const option of ["tagNameStyleIsolation", "enableScrollViewAutoSize"]) {
  if (Object.prototype.hasOwnProperty.call(skylineOptions, option)) {
    failures.push(`app.json: rendererOptions.skyline 包含无效配置 ${option}`);
  }
}

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
  !navigationTemplate.includes("back && insetBack") ||
  navigationTemplate.includes("insetTitle") ||
  navigationTemplate.includes("backOffset") ||
  navigationTemplate.includes("scrolled") ||
  navigationScript.includes("scrolled") ||
  navigationScript.includes("backOffset") ||
  navigationScript.includes("insetTitle") ||
  !navigationScript.includes("insetBack: { type: Boolean, value: false }") ||
  !navigationScript.includes("const NAVIGATION_INSET_RPX = 28") ||
  !navigationScript.includes("const STANDARD_BACK_BOTTOM_GAP_PX = 4") ||
  !navigationScript.includes(
    "(NAVIGATION_INSET_RPX * windowInfo.windowWidth) / 750",
  ) ||
  !navigationScript.includes(
    "controlTop + (contentHeight - backButtonSize) / 2",
  ) ||
  !navigationScript.includes("naturalBackTop - navigationInset") ||
  !navigationScript.includes("backLift,") ||
  !navigationScript.includes("const controlTop = menu.top") ||
  !navigationScript.includes("const nativeControlBottom = menu.bottom") ||
  !navigationScript.includes(
    "const insetBack = this.data.back && this.data.insetBack",
  ) ||
  !navigationScript.includes("const standardBackCoverHeight =") ||
  !navigationScript.includes(
    "naturalBackTop + backButtonSize + STANDARD_BACK_BOTTOM_GAP_PX",
  ) ||
  !navigationScript.includes("const coverHeight = insetBack") ||
  !navigationScript.includes(": this.data.back") ||
  !navigationScript.includes(
    "? Math.max(nativeControlBottom, standardBackCoverHeight)",
  ) ||
  !navigationScript.includes(": nativeControlBottom") ||
  !navigationScript.includes("const backLift = insetBack") ||
  !navigationScript.includes("totalHeight: coverHeight") ||
  pageNavigationSources.includes("headerScrolled") ||
  !navigationStyles.includes(
    ".nav-cover {\n  position: fixed;\n  top: 0;\n  right: 0;\n  left: 0;\n  z-index: 700;",
  ) ||
  !navigationStyles.includes("pointer-events: none;") ||
  !navigationStyles.includes(".nav-spacer {\n  flex: none;\n  width: 100%;") ||
  !navigationStyles.includes(
    ".nav-shell {\n  position: fixed;\n  top: 0;\n  right: 0;\n  left: 0;\n  z-index: 800;",
  ) ||
  !navigationStyles.includes(".nav-content {\n  position: absolute;")
) {
  failures.push(
    "components/navigation-bar: 普通页面遮罩必须低于返回按钮，内嵌标题须与返回按钮保持同一行，且不得触发滚动状态重绘",
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
const homeScript = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "home", "index.ts"),
  "utf8",
);
const homeStyles = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "home", "index.wxss"),
  "utf8",
);
const gradesTemplate = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "grades", "index.wxml"),
  "utf8",
);
const gradesScript = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "grades", "index.ts"),
  "utf8",
);
const gradesStyles = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "grades", "index.wxss"),
  "utf8",
);
const gradeSortTemplate = fs.readFileSync(
  path.join(
    miniprogramRoot,
    "components",
    "grade-sort-filter",
    "grade-sort-filter.wxml",
  ),
  "utf8",
);
const gradeSortScript = fs.readFileSync(
  path.join(
    miniprogramRoot,
    "components",
    "grade-sort-filter",
    "grade-sort-filter.ts",
  ),
  "utf8",
);
const gradeSortStyles = fs.readFileSync(
  path.join(
    miniprogramRoot,
    "components",
    "grade-sort-filter",
    "grade-sort-filter.wxss",
  ),
  "utf8",
);
const gradeDetailTemplate = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "grade-detail", "index.wxml"),
  "utf8",
);
const gradeDetailScript = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "grade-detail", "index.ts"),
  "utf8",
);
const progressRingScript = fs.readFileSync(
  path.join(miniprogramRoot, "utils", "progress-ring.ts"),
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
  !homeTemplate.includes('bind:tap="openGrades"') ||
  !homeScript.includes("openGrades()") ||
  !homeTemplate.includes('bind:tap="openElectricity"') ||
  !electricityTemplate.includes('title="宿舍用电与余额"')
) {
  failures.push(
    "pages/home/index.wxml: 成绩与寝室电费必须使用与课表一致的卡片放大转场",
  );
}
if (
  !homeTemplate.includes(
    "transform-origin: {{publicationPanelTransformOrigin}}",
  ) ||
  !homeScript.includes("rectLeft + rectWidth / 2 - panelInset") ||
  !homeScript.includes("rectTop + rectHeight / 2 - panelTop") ||
  homeStyles.includes("transform-origin: calc(100% - 44rpx) 0")
) {
  failures.push("pages/home/index.wxml: 通知弹窗必须以铃铛中心作为缩放原点");
}
if (
  !homeTemplate.includes(
    'class="score-ring-image" src="{{gradeRingSource}}" mode="aspectFit"',
  ) ||
  !gradesTemplate.includes(
    'class="average-ring-image" src="{{averageRingSource}}" mode="aspectFit"',
  ) ||
  homeTemplate.includes("home-grade-ring-canvas") ||
  gradesTemplate.includes("grades-average-ring-canvas") ||
  homeTemplate.includes("score-ring-progress") ||
  gradesTemplate.includes("average-ring-progress") ||
  homeTemplate.includes("score-ring-half") ||
  gradesTemplate.includes("average-ring-half") ||
  !homeScript.includes("gradeRingSource: progressRingSource(") ||
  !homeScript.includes("gradePointRingValue(summary.gradePointAverage)") ||
  !homeTemplate.includes("{{gradePointAverageLabel}}") ||
  !homeTemplate.includes("· 均分 ") ||
  !gradesScript.includes("averageRingSource: progressRingSource(") ||
  !homeScript.includes('this.data.motionClass !== "motion-reduced"') ||
  !gradesScript.includes('this.data.motionClass !== "motion-reduced"') ||
  !progressRingScript.includes("Math.min(100, value)") ||
  !progressRingScript.includes('fill="none"') ||
  !progressRingScript.includes("stroke-dasharray") ||
  !progressRingScript.includes('attributeName="stroke-dasharray"') ||
  homeStyles.includes("mask-image") ||
  gradesStyles.includes("mask-image") ||
  /\.score-ring\s*\{[^}]*\bborder\s*:/.test(homeStyles) ||
  /\.average-ring\s*\{[^}]*\bborder\s*:/.test(gradesStyles)
) {
  failures.push(
    "pages/home、pages/grades: 首页绩点圆环须以 5.0 为满环，成绩页均分圆环须以 100 为满环",
  );
}
if (
  gradesTemplate.includes("<bottom-sheet") ||
  gradesTemplate.includes("学年</text>") ||
  !gradesTemplate.includes('<grade-sort-filter id="grade-sort-filter"') ||
  gradesTemplate.includes('class="grade-sort-popover"') ||
  gradesScript.includes("filterVisible") ||
  !gradesScript.includes("this.selectComponent(") ||
  !gradesScript.includes('"#grade-sort-filter",') ||
  !gradesTemplate.includes('wx:key="renderKey"') ||
  !gradesTemplate.includes(
    "class=\"grade-card-motion {{item.animateEntry ? 'stagger-item' : ''}}\"",
  ) ||
  !gradesTemplate.includes('class="grade-card card pressable"') ||
  gradesTemplate.includes('class="grade-card card pressable stagger-item"') ||
  !gradesScript.includes("let gradeRenderBatch = 0;") ||
  !gradesScript.includes("`${gradeRenderBatch}:${course.id}`") ||
  !gradesScript.includes("let gradeListAnimationRequested = true;") ||
  !gradesScript.includes("animateEntries || animatedIds.has(course.id)") ||
  gradesScript.includes("gradeAnimationTimer") ||
  !gradeSortTemplate.includes('class="grade-sort-popover"') ||
  !gradeSortScript.includes("分数高→低") ||
  !gradeSortScript.includes("分数低→高") ||
  !gradeSortScript.includes("if (value === this.data.value) {") ||
  !gradeSortScript.includes("this.setData({ visible: false }, () => {") ||
  !gradeSortScript.includes('this.triggerEvent("change", { value })') ||
  !gradeSortStyles.includes("background: transparent") ||
  !gradesTemplate.includes("extra-left") ||
  !gradesScript.includes('sort: "default"') ||
  !gradesScript.includes("initializeLatestSemester") ||
  !gradesScript.includes("this.applyGradesData(\n          result.data,") ||
  gradesScript.includes("!canonical ||") ||
  !gradesScript.includes("最后更新于") ||
  gradesScript.includes("缓存更新于")
) {
  failures.push(
    "pages/grades: 排序浮窗必须隔离页面状态，成绩卡片只在首次进入和切换排序时整批播放动画",
  );
}
if (
  !gradeDetailTemplate.includes('title="{{detailTitle}}"') ||
  !gradeDetailTemplate.includes('inset-back="{{true}}"') ||
  !gradeDetailTemplate.includes('style="width: {{item.width}}%;"') ||
  !gradeDetailScript.includes("gradeComponentWidths(sourceComponents)") ||
  !gradeDetailScript.includes(
    'detailTitle: showComponentsSection ? "课程成绩与组成" : "课程成绩"',
  ) ||
  !gradeDetailTemplate.includes(
    '<block wx:if="{{showComponentsSection}}">',
  ) ||
  gradeDetailTemplate.includes("教务系统返回的全部细分项目") ||
  gradeDetailTemplate.includes("只保留查询有用的字段") ||
  gradeDetailTemplate.includes("数字成绩以数字展示")
) {
  failures.push(
    "pages/grade-detail: 详情标题、内嵌返回按钮及普通成绩的真实权重组成必须正确展示",
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
  !passRateTemplate.includes("({{item.courses.length}})") ||
  passRateTemplate.includes("back-offset") ||
  !passRateTemplate.includes('inset-back="{{true}}"') ||
  !passRateScript.includes("function toCourseRows(") ||
  !passRateScript.includes("function coursePickerState(") ||
  !passRateScript.includes("shortAcademicSemesterLabel(") ||
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

if (
  !/\.composition-title\s*\{[^}]*font-size:\s*20rpx/.test(passRateStyles) ||
  !/\.composition-tags text\s*\{[^}]*font-size:\s*19rpx/.test(passRateStyles)
) {
  failures.push(
    "pages/pass-rates: 顶部卡片的成绩组成标题和个人成绩明细必须保持放大后的字号",
  );
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("WXML Skyline checks passed.");
}
