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
const { renderMarkdown } = loadTypeScriptModule("utils/markdown.ts");
const { sortPublicationsNewestFirst } = loadTypeScriptModule(
  "utils/publications.ts",
);
const {
  isCurrentSemesterId,
  isCurrentSemesterTimestamp,
  startedCurrentSemester,
} = loadTypeScriptModule("utils/semester.ts");
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
const appScript = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "app.ts"),
  "utf8",
);
const appearanceScript = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "utils", "appearance.ts"),
  "utf8",
);
const tabBarScript = fs.readFileSync(
  path.resolve(__dirname, "..", "miniprogram", "custom-tab-bar", "index.ts"),
  "utf8",
);

const homePageSettle =
  homeStyles.match(/@keyframes home-page-settle\s*\{[\s\S]*?\n\}/)?.[0] || "";
const homeItemSettle =
  homeStyles.match(/@keyframes home-item-settle\s*\{[\s\S]*?\n\}/)?.[0] || "";
assert(
  homeScript.includes(
    "const INITIAL_HOME_APPEARANCE = resolveAppearance(loadPreferences());",
  ) &&
    homeScript.includes("...INITIAL_HOME_APPEARANCE") &&
    homeScript.includes("syncWindowBackground(appearance.theme);") &&
    appearanceScript.includes("export function syncWindowBackground(") &&
    appearanceScript.includes("wx.setBackgroundColor({") &&
    appearanceScript.includes('theme === "dark" ? "#171613" : "#f7f5ef"') &&
    tabBarScript.includes(
      "const INITIAL_TAB_APPEARANCE = resolveAppearance(loadPreferences());",
    ) &&
    tabBarScript.includes(
      "const INITIAL_TAB_HIDDEN = !Boolean(getSession()?.token);",
    ) &&
    tabBarScript.includes("hidden: INITIAL_TAB_HIDDEN") &&
    tabBarScript.includes("themeClass: INITIAL_TAB_APPEARANCE.themeClass") &&
    homeStyles.includes(".home-page .page-enter {") &&
    homeStyles.includes("animation-name: home-page-settle;") &&
    homeStyles.includes(".home-page .stagger-item {") &&
    homeStyles.includes("animation-name: home-item-settle;") &&
    homePageSettle.length > 0 &&
    homeItemSettle.length > 0 &&
    !homePageSettle.includes("opacity") &&
    !homeItemSettle.includes("opacity"),
  "首页、窗口和底栏必须从首帧使用同一主题，首页入场不得从全透明状态开始",
);

assert(
  /onLoad\(\)[\s\S]*?registerHomeAuthenticationHost\(this\);[\s\S]*?if \(getSession\(\)\?\.token\) \{[\s\S]*?this\.hydrateIdentity\(\)/.test(
    homeScript,
  ) && /onShow\(\)[\s\S]*?this\.hydrateIdentity\(\)/.test(homeScript),
  "首页进入和再次显示时都必须同步恢复用户姓名",
);
assert(
  homeScript.includes("const HOME_FIRST_FRAME_SETTLE_MS = 32;") &&
    homeScript.includes("const HOME_LOGIN_REVEAL_SETTLE_MS = 360;") &&
    /onReady\(\)[\s\S]*?homeReady = true;[\s\S]*?HOME_LOGIN_REVEAL_SETTLE_MS[\s\S]*?this\.scheduleHomeActivation\(delay\)/.test(
      homeScript,
    ) &&
    /onShow\(\)[\s\S]*?homeVisible = true;[\s\S]*?this\.prepareForAuthenticatedReveal\(\);[\s\S]*?if \(homeReady\)/.test(
      homeScript,
    ) &&
    /prepareForAuthenticatedReveal\(onReady\?: \(\) => void\)[\s\S]*?authenticated: true[\s\S]*?this\.hydrateCachedDashboard\(\);[\s\S]*?wx\.nextTick\(\(\) => \{[\s\S]*?isSessionLeaseCurrent\(lease\)[\s\S]*?onReady\?\.\(\)/.test(
      homeScript,
    ) &&
    /activateHomeAfterFirstFrame\(\)[\s\S]*?const petSetupPending = this\.openPendingPetSetup\(sessionAccount\);[\s\S]*?void this\.loadDashboard\(false\)/.test(
      homeScript,
    ) &&
    !homeScript.includes(
      "if (this.openPendingPetSetup(sessionAccount)) return",
    ) &&
    homeTemplate.includes("<pet-picker-drawer") &&
    homeTemplate.includes(
      '<root-portal wx:if="{{authenticated && petSetupDrawerMounted}}">',
    ) &&
    homeTemplate.includes("home-framework--guarded") &&
    homeTemplate.includes(
      'wx:if="{{!authenticated}}" class="home-auth-guard"',
    ) &&
    homeTemplate.includes('class="home-auth-login-stage"') &&
    homeTemplate.includes("欢迎来到{{appName}}") &&
    homeStyles.includes(".home-framework--guarded {") &&
    homeStyles.includes("visibility: hidden;") &&
    homeStyles.includes("animation-name: home-auth-login-backdrop-in;") &&
    homeTemplate.includes('bind:finish="finishPendingPetSetup"'),
  "首页必须在登录页下预挂载匿名框架，提交可见首帧后再返回并静默刷新数据",
);
assert(
  appScript.includes("foregroundEntryId: 0") &&
    /onShow\(\) \{[\s\S]*?this\.globalData\.foregroundEntryId \+= 1;/.test(
      appScript,
    ) &&
    /const currentAutomaticPopupEntryKey = `\$\{getApp<IAppOption>\(\)\.globalData\.foregroundEntryId\}:\$\{sessionAccount\}`;[\s\S]*?if \(currentAutomaticPopupEntryKey !== automaticPopupEntryKey\) \{[\s\S]*?automaticPopupsThisEntry = new Set<string>\(\);[\s\S]*?\}/.test(
      homeScript,
    ),
  "每次弹出公告必须按小程序前台进入周期去重，不能在每次返回主页时重置",
);
assert(
  homeScript.includes("const PUBLICATION_REFRESH_THROTTLE_MS = 8_000;") &&
    /activateHomeAfterFirstFrame\(\)[\s\S]*?void this\.loadPublicationFeed\(\)/.test(
      homeScript,
    ) &&
    /async loadPublicationFeed\(\) \{[\s\S]*?now - lastPublicationRequestAt < PUBLICATION_REFRESH_THROTTLE_MS[\s\S]*?lastPublicationRequestAt = now;[\s\S]*?getPublicationFeed\(\)/.test(
      homeScript,
    ) &&
    /onLoad\(\)[\s\S]*?lastPublicationRequestAt = 0;/.test(homeScript) &&
    !homeScript.includes("setInterval(() => this.loadPublicationFeed"),
  "主页重新显示时必须静默同步公告与通知，以八秒间隔限制重复请求且不得定时轮询",
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

const semesterContext = {
  semester: { id: "2026-1" },
  currentSemester: {
    id: "2026-1",
    startDate: "2026-08-31",
    endDate: "2027-01-17",
  },
  semesterCalendar: null,
};
assert(
  startedCurrentSemester(semesterContext, "2026-08-30") === null,
  "新学期预览不得在正式开学日前提前清空",
);
const startedSemester = startedCurrentSemester(
  semesterContext,
  "2026-08-31",
);
assert(
  startedSemester?.semesterId === "2026-1" &&
    isCurrentSemesterTimestamp("2026-08-31 00:00:00", startedSemester) &&
    !isCurrentSemesterTimestamp("2026-08-30 23:59:59", startedSemester) &&
    isCurrentSemesterId("2026-1", startedSemester) &&
    !isCurrentSemesterId("2025-2", startedSemester),
  "开学当天起必须按当前学期过滤主页考试、教务消息和学校通知预览",
);
assert(
  homeScript.includes("startedCurrentSemester(activeTimetable)") &&
    homeScript.includes("isCurrentSemesterTimestamp(message.createdAt") &&
    homeScript.includes("isCurrentSemesterTimestamp(notice.publishedAt") &&
    homeScript.includes("isCurrentSemesterId(examData?.semester?.id") &&
    /\.campus-card\s*\{[^}]*min-height:\s*198rpx/s.test(homeStyles) &&
    /\.exam-card\s*\{[^}]*min-height:\s*294rpx/s.test(homeStyles) &&
    /\.exam-empty\s*\{[^}]*min-height:\s*212rpx[^}]*font-size:\s*25rpx/s.test(
      homeStyles,
    ) &&
    /\.campus-empty-copy\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*min-height:\s*138rpx[^}]*font-size:\s*25rpx/s.test(
      homeStyles,
    ) &&
    (homeTemplate.match(/<view wx:else class="campus-empty-copy">/g) || [])
      .length === 2,
  "主页必须过滤旧学期预览，同时保持考试和校园消息卡片的既有高度",
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
  /const gradeRequest = includeStableData[\s\S]*?getGrades\([\s\S]*?refresh: refreshStable[\s\S]*?\.then\([\s\S]*?\(result\) => \{[\s\S]*?this\.hydrateServerGrade\(account, result, refreshStable\)/.test(
    homeScript,
  ) &&
    /hydrateServerGrade\([\s\S]*?saveGradesSnapshot\([\s\S]*?this\.setData\([\s\S]*?gradePreviewPatch\(/.test(
      homeScript,
    ),
  "首页必须在服务器成绩快照返回时立即缓存并渲染，不能等待其他首页请求",
);

const publicationPopoverStyle =
  /\.publication-popover \{([^}]*)\}/.exec(homeStyles)?.[1] || "";
const publicationPopoverScrollStyle =
  /\.publication-popover-scroll \{([^}]*)\}/.exec(homeStyles)?.[1] || "";
const publicationRowStyle =
  /\.publication-row \{([^}]*)\}/.exec(homeStyles)?.[1] || "";
const publicationBodyStyle =
  /\.publication-body \{([^}]*)\}/.exec(homeStyles)?.[1] || "";
const publicationBodyExpandedStyle =
  /\.publication-body--expanded \{([^}]*)\}/.exec(homeStyles)?.[1] || "";
const publicationBodyPreviewStyle =
  /\.publication-body-preview \{([^}]*)\}/.exec(homeStyles)?.[1] || "";
const publicationBodyContentStyle =
  /\.publication-body-content \{([^}]*)\}/.exec(homeStyles)?.[1] || "";
const expandedPublicationBodyPreviewStyle =
  /\.publication-body--expanded \.publication-body-preview \{([^}]*)\}/.exec(
    homeStyles,
  )?.[1] || "";
const expandedPublicationBodyContentStyle =
  /\.publication-body--expanded \.publication-body-content \{([^}]*)\}/.exec(
    homeStyles,
  )?.[1] || "";
const publicationTapHandler =
  /onPublicationTap\(event: WechatMiniprogram\.TouchEvent\) \{([\s\S]*?)\n  \},\n  showNextQueuedAnnouncement/.exec(
    homeScript,
  )?.[1] || "";
const publicationPanelMeasure =
  /measurePublicationPanel\(openAfterMeasure: boolean\) \{([\s\S]*?)\n  \},\n  closePublicationPanel/.exec(
    homeScript,
  )?.[1] || "";
assert(
  !homeTemplate.includes("publication-popover--empty") &&
    publicationPopoverStyle.includes("display: flex;") &&
    publicationPopoverStyle.includes("flex-direction: column;") &&
    publicationPopoverStyle.includes("height: 680rpx;") &&
    publicationPopoverStyle.includes("max-height: 62vh;") &&
    publicationPopoverScrollStyle.includes("flex: none;") &&
    publicationPopoverScrollStyle.includes("min-height: 0;") &&
    !publicationPopoverScrollStyle.includes("transition: height") &&
    !/(?:^|;)\s*height:/.test(publicationPopoverScrollStyle) &&
    homeTemplate.includes('class="publication-popover-content"') &&
    homeTemplate.includes(
      'style="height: {{publicationPanelScrollHeight}}px;"',
    ) &&
    /class="publication-popover-scroll"[^>]*type="custom"/.test(homeTemplate) &&
    publicationPanelMeasure.includes(
      "const fixedPanelHeight = (680 * windowWidth) / 750;",
    ) &&
    publicationPanelMeasure.includes(
      "const maxPanelHeight = windowHeight * 0.62;",
    ) &&
    publicationPanelMeasure.includes("publicationPanelScrollHeight") &&
    !publicationPanelMeasure.includes('selectAll(".publication-row")') &&
    !publicationPanelMeasure.includes('select(".publication-empty")'),
  "首页消息弹窗必须始终保持四条消息高度，展开正文时不得改变外层高度",
);
assert(
  /wx:for="\{\{publications\}\}"[^>]*class="publication-row"[^>]*catchtap="onPublicationTap"/.test(
    homeTemplate,
  ) &&
    !homeTemplate.includes('hover-class="publication-row--pressed"') &&
    !homeTemplate.includes("publication-row--unread") &&
    !homeStyles.includes(".publication-row--pressed") &&
    !homeStyles.includes(".publication-row--unread") &&
    !publicationRowStyle.includes("background") &&
    (publicationTapHandler.match(/this\.setData\(/g) || []).length === 1 &&
    publicationTapHandler.includes('publication.kind === "announcement"') &&
    publicationTapHandler.includes("isRead: true") &&
    publicationTapHandler.includes("expanded:") &&
    !publicationTapHandler.includes("measurePublicationPanel") &&
    !publicationTapHandler.includes("markPublicationLocallyRead"),
  "首页消息点击必须立即合并更新已读和展开状态，且不得因未读背景切换产生深色按压闪变",
);
const compactNotification = renderMarkdown("第一行\n第二行", {
  compact: true,
});
assert(
  compactNotification.includes("font-size:14px") &&
    homeScript.includes('compact: publication.kind === "notification"') &&
    homeTemplate.includes('class="publication-body-preview"') &&
    homeTemplate.includes('class="publication-body-content"') &&
    !homeTemplate.includes('<rich-text wx:if="{{item.expanded}}"') &&
    publicationBodyStyle.includes("font-size: 20rpx;") &&
    publicationBodyStyle.includes("max-height: 30rpx;") &&
    publicationBodyStyle.includes(
      "transition: max-height 280ms cubic-bezier(0.22, 1, 0.36, 1);",
    ) &&
    publicationBodyExpandedStyle.includes("max-height: 300rpx;") &&
    publicationBodyExpandedStyle.includes("transition-duration: 460ms;") &&
    publicationBodyExpandedStyle.includes(
      "transition-timing-function: cubic-bezier(0.25, 0.1, 0.25, 1);",
    ) &&
    publicationBodyPreviewStyle.includes(
      "transition: opacity 100ms ease 180ms;",
    ) &&
    publicationBodyContentStyle.includes(
      "transition: opacity 100ms ease 180ms;",
    ) &&
    expandedPublicationBodyPreviewStyle.includes(
      "transition: opacity 140ms ease;",
    ) &&
    expandedPublicationBodyContentStyle.includes(
      "transition: opacity 220ms ease 90ms;",
    ),
  "多行通知必须使用较小正文字号和稳定内容节点平滑展开、折叠",
);
const orderedPublications = sortPublicationsNewestFirst([
  {
    id: "oldest",
    startsAt: "2026-08-17T08:00:00.000Z",
    createdAt: "2026-08-17T08:00:00.000Z",
  },
  {
    id: "newest",
    startsAt: "2026-08-19T08:00:00.000Z",
    createdAt: "2026-08-19T08:00:00.000Z",
  },
  {
    id: "middle",
    startsAt: "2026-08-18T08:00:00.000Z",
    createdAt: "2026-08-18T08:00:00.000Z",
  },
]);
assert(
  orderedPublications.map((item) => item.id).join(",") ===
    "newest,middle,oldest" &&
    homeScript.includes("sortPublicationsNewestFirst(feed.items)") &&
    homeTemplate.includes('class="publication-list"') &&
    !homeTemplate.includes('class="publication-group-header"') &&
    !homeTemplate.includes('wx:for="{{announcements}}"') &&
    !homeTemplate.includes('wx:for="{{platformNotifications}}"'),
  "首页公告与通知必须合并为一个列表，并按发布时间倒序排列",
);

const darkAnnouncement = renderMarkdown("# 公告\n\n正文", { theme: "dark" });
const announcementModalStyle =
  /\.announcement-modal \{([^}]*)\}/.exec(homeStyles)?.[1] || "";
assert(
  darkAnnouncement.includes("正文") &&
    darkAnnouncement.includes("color:#ddd5c7") &&
    darkAnnouncement.includes("color:#f7f3e9"),
  "深色模式公告正文和标题必须使用可读的亮色",
);
const plainDelimitedText = renderMarkdown("*星号包裹* 与 _下划线包裹_");
const plainDelimitedLatin = renderMarkdown("normal *plain words* normal");
assert(
  plainDelimitedText.includes("星号包裹 与 下划线包裹") &&
    !plainDelimitedText.includes("<em") &&
    !plainDelimitedText.includes("*星号包裹*") &&
    !plainDelimitedText.includes("_下划线包裹_") &&
    !homeStyles.includes(".publication-body em") &&
    !homeStyles.includes(".announcement-article em"),
  "公告 Markdown 的单星号和单下划线只应移除包裹符并输出普通正文",
);
assert(
  plainDelimitedLatin.includes("normal plain words normal") &&
    !plainDelimitedLatin.includes("<em"),
  "公告 Markdown 的英文单星号内容必须保持普通行内排版",
);
assert(
  /<root-portal[\s\S]*?announcement-modal-layer[\s\S]*?<\/root-portal>/.test(
    homeTemplate,
  ) &&
    homeTemplate.includes('class="announcement-content-body"') &&
    homeTemplate.includes('style="height: {{announcementScrollHeight}}px;"') &&
    /class="announcement-content"[^>]*type="custom"/.test(homeTemplate) &&
    homeTemplate.includes('class="announcement-content-end"') &&
    /\.announcement-modal-layer \{[^}]*z-index: 1300;[^}]*\}/.test(
      homeStyles,
    ) &&
    announcementModalStyle.includes("max-height: 86vh;") &&
    announcementModalStyle.includes("overflow: hidden;") &&
    !/(?:^|;)\s*height:\s*86vh;/.test(announcementModalStyle) &&
    /\.announcement-content \{[^}]*flex: none;[^}]*min-height: 0;[^}]*\}/.test(
      homeStyles,
    ) &&
    /measureAnnouncementModal\([\s\S]*?\.select\("\.announcement-header"\)[\s\S]*?\.select\("\.announcement-footer"\)[\s\S]*?\.select\("\.announcement-article"\)[\s\S]*?\.select\("\.announcement-content-end"\)[\s\S]*?maxModalHeight[\s\S]*?announcementScrollHeight/.test(
      homeScript,
    ) &&
    /presentAnnouncement\([\s\S]*?this\.setTabBarHidden\(true\)/.test(
      homeScript,
    ) &&
    /closeAnnouncementModal\([\s\S]*?this\.setTabBarHidden\(false\)/.test(
      homeScript,
    ) &&
    /resetPublicationLayers\([\s\S]*?this\.setTabBarHidden\(false\)/.test(
      homeScript,
    ),
  "公告抽屉必须按内容自适应，并在达到最大高度后滚动正文",
);

console.log("Home cache and identity checks passed.");
