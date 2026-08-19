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

assert(
  /onLoad\(\)[\s\S]*?this\.hydrateIdentity\(\)/.test(homeScript) &&
    /onShow\(\)[\s\S]*?this\.hydrateIdentity\(\)/.test(homeScript),
  "首页进入和再次显示时都必须同步恢复用户姓名",
);
assert(
  /onShow\(\)[\s\S]*?const petSetupPending = this\.openPendingPetSetup\(sessionAccount\);[\s\S]*?this\.hydrateIdentity\(\);[\s\S]*?void this\.loadDashboard\(false\)/.test(
    homeScript,
  ) &&
    !homeScript.includes(
      "if (this.openPendingPetSetup(sessionAccount)) return",
    ) &&
    homeTemplate.includes("<pet-picker-drawer") &&
    homeTemplate.includes('<root-portal wx:if="{{petSetupDrawerMounted}}">') &&
    homeTemplate.includes('bind:finish="finishPendingPetSetup"'),
  "首次伙伴抽屉显示期间必须继续静默刷新首页与用户资料，且只能在首页完成或跳过",
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
    /onShow\(\)[\s\S]*?void this\.loadPublicationFeed\(\)/.test(homeScript) &&
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
