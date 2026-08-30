const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pageRoot = path.resolve(
  __dirname,
  "..",
  "miniprogram",
  "features",
  "pages",
  "rooms",
);
const template = fs.readFileSync(path.join(pageRoot, "index.wxml"), "utf8");
const script = fs.readFileSync(path.join(pageRoot, "index.ts"), "utf8");
const styles = fs.readFileSync(path.join(pageRoot, "index.wxss"), "utf8");
const navigationRoot = path.resolve(
  __dirname,
  "..",
  "miniprogram",
  "components",
  "navigation-bar",
);
const navigationTemplate = fs.readFileSync(
  path.join(navigationRoot, "navigation-bar.wxml"),
  "utf8",
);
const navigationScript = fs.readFileSync(
  path.join(navigationRoot, "navigation-bar.ts"),
  "utf8",
);
const navigationStyles = fs.readFileSync(
  path.join(navigationRoot, "navigation-bar.wxss"),
  "utf8",
);

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
  new Function("module", "exports", output)(moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

const { resolveInitialRoomDate, formatRoomResultDate } = loadTypeScriptModule(
  "features/utils/room-date.ts",
);
const { groupRoomsByFloor } = loadTypeScriptModule(
  "features/utils/room-floor.ts",
);

assert(
  !template.includes("refresher-") &&
    !template.includes("bindrefresherrefresh") &&
    !script.includes("refreshing:") &&
    !script.includes("onRefresh()"),
  "空教室页不得声明原生下拉刷新，避免 Skyline 报 Cannot find refresher",
);

assert(
  template.includes('inset-back="{{true}}"') &&
    !template.includes("找个地方自习"),
  "空教室页返回按钮必须与通过率页使用同一内缩位置，且不再显示副标题",
);

assert(
  template.includes(
    'title="空教室" back="{{true}}" inset-back="{{true}}" transparent="{{true}}"',
  ) &&
    !navigationScript.includes("insetTitle:") &&
    navigationTemplate.includes("back && insetBack") &&
    /\.nav-title\s*\{[\s\S]*?font-family:[\s\S]*?serif;/.test(
      navigationStyles,
    ) &&
    /\.nav-title-wrap\s*\{[\s\S]*?z-index:\s*3;[\s\S]*?pointer-events:\s*none;/.test(
      navigationStyles,
    ) &&
    /\.nav-title\s*\{[\s\S]*?display:\s*block;[\s\S]*?color:\s*#16161a;/.test(
      navigationStyles,
    ) &&
    /\.nav-shell--dark \.nav-title\s*\{[\s\S]*?color:\s*#f7f3e9;/.test(
      navigationStyles,
    ),
  "空教室标题必须使用衬线字并与内缩返回按钮在同一行",
);

assert(
  !template.includes("学校教务管理系统") &&
    !template.includes("数据更新于") &&
    !template.includes("不可早于今天"),
  "空教室页不得显示数据来源、更新时间或日期限制说明",
);

assert(
  template.includes('class="rooms-loading" aria-role="alert"') &&
    template.includes('class="rooms-loading-spinner"') &&
    template.includes('<text class="rooms-loading-label">读取中</text>') &&
    !/<view wx:if="{{optionsLoading && !campuses.length}}"[^>]*>\s*<loading-view/.test(
      template,
    ) &&
    /\.rooms-content--loading\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;[\s\S]*?height:\s*calc\(100vh - 132rpx\);[\s\S]*?min-height:\s*0;[\s\S]*?padding-top:\s*0;[\s\S]*?padding-bottom:\s*132rpx;/.test(
      styles,
    ) &&
    /\.rooms-loading\s*\{[\s\S]*?flex:\s*none;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;/.test(
      styles,
    ) &&
    !template.includes("正在读取校区与节次"),
  "空教室首次加载必须仅显示“读取中”和加载圈，并以导航栏等高底部留白保持整屏垂直居中",
);

assert(
  template.includes('class="campus-indicator"') &&
    !template.includes('class="query-label">校区</text>') &&
    /\.campus-switch\s*\{[\s\S]*?border-radius:\s*999rpx;/.test(styles) &&
    /\.campus-indicator\s*\{[\s\S]*?transition:\s*transform/.test(styles),
  "校区必须使用无标题的胶囊形平滑移动选择器",
);

assert(
  /Array\.from\(\{ length: 7 \}/.test(script) &&
    template.includes('wx:for="{{quickDates}}"') &&
    template.includes('class="quick-date-indicator"') &&
    /onDateChange[\s\S]*?\.\.\.selectQuickDate\(this\.data\.quickDates, date\)/.test(
      script,
    ) &&
    /selectQuickDate[\s\S]*?dateLabel: formatFriendlyDate\(date\)/.test(
      script,
    ) &&
    script.includes(
      "left: 10rpx; width: calc((100% - 20rpx) / ${options.length});",
    ) &&
    /\.quick-date-track\s*\{[\s\S]*?border-radius:\s*999rpx;/.test(styles) &&
    /\.quick-date-track\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?padding:\s*0 10rpx;/.test(
      styles,
    ) &&
    /\.quick-date-indicator\s*\{[\s\S]*?border-radius:\s*50%;/.test(styles),
  "日期必须提供两端留有间距的圆形指示器，在胶囊滑轨上完成 7 天快捷选择并与原生日期选择器双向同步",
);

assert(
  script.includes("buildingsByCampus") &&
    /const result = await getRoomOptions\(\)/.test(script) &&
    !/getRoomOptions\(campusId\)/.test(script) &&
    /selectCampusInline[\s\S]*?this\.data\.buildingsByCampus\[campusId\]/.test(
      script,
    ),
  "首次选项请求必须带回所有校区教学楼，切换校区不得再次请求",
);

assert(
  template.includes('wx:elif="{{buildings.length}}" class="building-grid"') &&
    !template.includes('class="building-scroll"') &&
    !template.includes('class="building-check"') &&
    /\.building-grid\s*\{[\s\S]*?margin-top:\s*14rpx;/.test(styles),
  "教学楼必须由页面主滚动直接渲染，且仅用颜色表示选中状态",
);

assert(
  resolveInitialRoomDate(
    "2026-08-18",
    "",
    new Date("2026-08-18T13:59:59.000Z"),
  ) === "2026-08-18" &&
    resolveInitialRoomDate(
      "2026-08-18",
      "",
      new Date("2026-08-18T14:00:00.000Z"),
    ) === "2026-08-19" &&
    resolveInitialRoomDate(
      "2026-12-31",
      "",
      new Date("2026-12-31T15:00:00.000Z"),
    ) === "2027-01-01",
  "北京时间 22:00 起必须默认选中次日，并正确处理跨月跨年",
);

assert(
  resolveInitialRoomDate(
    "2026-08-31",
    "",
    new Date("2026-08-23T15:00:00.000Z"),
    "2027-01-17",
  ) === "2026-08-31" &&
    resolveInitialRoomDate(
      "2026-08-23",
      "",
      new Date("2026-08-23T15:00:00.000Z"),
      "2026-08-23",
    ) === "2026-08-23",
  "晚间顺延只能作用于北京时间当天，未来开学日和查询范围末日不得被错误推进",
);

assert(
  formatRoomResultDate("2026-08-18") === "8-18 周二" &&
    formatRoomResultDate("invalid") === "invalid",
  "结果抽屉日期必须使用月-日格式并保留星期",
);

assert(
  styles.includes("#d97757") && !styles.includes("linear-gradient"),
  "空教室页必须统一使用无渐变的 Anthropic 橙色",
);

assert(
  template.includes('class="period-picker-layer"') &&
    template.includes('bindtap="openPeriodPicker"') &&
    template.includes('bindtap="togglePeriodGroup"') &&
    template.includes('bindtap="toggleDraftPeriod"') &&
    /\.period-picker-body\s*\{[\s\S]*?flex:\s*1;[\s\S]*?min-height:\s*0;/.test(
      styles,
    ) &&
    /\.period-picker-scroll\s*\{[\s\S]*?height:\s*100%;/.test(styles),
  "节次必须在具有完整高度链的抽屉内选择，并支持时段快捷多选",
);

assert(
  /closePeriodPicker\(\)[\s\S]*?const periods = \[\.\.\.this\.data\.draftPeriods\][\s\S]*?selectedPeriods: periods[\s\S]*?periodLabel: selectedPeriodLabel\(periods\)/.test(
    script,
  ) &&
    !/closePeriodPicker\(\)[\s\S]*?const selectedPeriods = this\.data\.selectedPeriods/.test(
      script,
    ),
  "关闭节次抽屉时必须提交当前草稿，不得用旧选择回滚",
);

const floorGroups = groupRoomsByFloor([
  { id: "third-a", floor: "3", building: { id: "30", name: "30教" } },
  {
    id: "basement-one",
    floor: "B1",
    building: { id: "30", name: "30教" },
  },
  { id: "second", floor: "2楼", building: { id: "30", name: "30教" } },
  {
    id: "third-b",
    floor: "3 层",
    building: { id: "30", name: "30教" },
  },
  { id: "other-building", floor: "2", building: { id: "31", name: "31教" } },
]);
assert(
  floorGroups.map((group) => group.label).join(",") ===
    "30教 · B1 层,30教 · 2 层,30教 · 3 层,31教 · 2 层" &&
    floorGroups.find((group) => group.label === "30教 · 3 层")?.rooms.length ===
      2,
  "查询结果必须按教学楼和楼层归组，并规范化、排序和合并同层教室",
);

const roomViewSource =
  script.match(/function toRoomView\(room: EmptyRoom\)[\s\S]*?\n\}/)?.[0] || "";
assert(
  template.includes('class="room-results-layer"') &&
    template.includes('wx:for="{{roomGroups}}"') &&
    template.includes('wx:for="{{roomGroup.rooms}}"') &&
    template.includes('bindscrolltolower="loadMore"') &&
    !/class="room-results-scroll"[^>]*\sbounces(?:\s|>)/.test(template) &&
    !/class="room-results-scroll"[^>]*refresher-/.test(template) &&
    /\.room-results-body\s*\{[\s\S]*?flex:\s*1;[\s\S]*?min-height:\s*0;/.test(
      styles,
    ) &&
    /\.room-results-scroll\s*\{[\s\S]*?height:\s*100%;/.test(styles) &&
    /\.room-results-card\s*\{[\s\S]*?height:\s*78vh;/.test(styles) &&
    template.includes('class="room-results-total tnum"') &&
    template.includes(
      'class="room-results-title">查询结果</text><text class="room-results-total tnum">{{totalRooms}}</text><text class="room-results-unit">间</text>',
    ) &&
    !template.includes('class="room-results-title">查询结果 <text') &&
    template.includes("{{resultDateLabel}} · {{resultPeriodLabel}}") &&
    /resultDateLabel: formatRoomResultDate\(queryDate\)/.test(script) &&
    /\.room-results-title-row\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*row;/.test(
      styles,
    ) &&
    template.includes('class="room-results-top-row"') &&
    /\.room-results-top-row\s*\{[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*space-between;/.test(
      styles,
    ) &&
    /\.room-results-title,[\s\S]*?font-size:\s*37rpx;/.test(styles) &&
    /\.room-results-caption\s*\{[\s\S]*?font-size:\s*21rpx;/.test(styles) &&
    !template.includes('class="building-summary-scroll"') &&
    /\.room-floor-heading\s*\{[\s\S]*?justify-content:\s*flex-start;[\s\S]*?gap:\s*14rpx;/.test(
      styles,
    ) &&
    /roomGroups: groupRoomsByFloor\(roomItems\)/.test(script) &&
    /if \(reset\) this\.openResultDrawer\(\)/.test(script),
  "查询结果必须在具有完整高度链的抽屉中按楼层展示，并在首次查询完成后打开",
);

assert(
  !roomViewSource.includes("room.floor") &&
    !roomViewSource.includes("locationLabel") &&
    roomViewSource.includes("`${room.capacity} 人`") &&
    !template.includes('class="room-location"') &&
    !template.includes('class="capacity-block"') &&
    !template.includes('class="capacity-label"') &&
    template.includes(
      'class="capacity-value tnum">{{room.capacityLabel}}</text>',
    ) &&
    /\.room-list\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?border-radius:\s*40rpx;/.test(
      styles,
    ) &&
    /\.room-icon\s*\{[\s\S]*?width:\s*68rpx;[\s\S]*?height:\s*68rpx;/.test(
      styles,
    ),
  "教室卡片必须删除中间信息行、降低高度，并只在右侧显示带“人”单位的容量",
);

assert(
  (template.match(/visualTheme === 'minimal'/g) || []).length >= 2 &&
    /\.rooms-page\.theme-style-minimal \.date-icon,[\s\S]*?\.rooms-page\.theme-style-minimal \.period-choice-icon\s*\{[\s\S]*?border-color:\s*var\(--color-text\);[\s\S]*?background:\s*transparent;/.test(
      styles,
    ),
  "极简模式的日期和节次图标必须使用黑白图标及无彩色底的黑白框线",
);

console.log("Empty-room page checks passed.");
