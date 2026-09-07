const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../miniprogram/features/pages/browser");
const source = fs.readFileSync(path.join(root, "index.ts"), "utf8");
const template = fs.readFileSync(path.join(root, "index.wxml"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const attachment = {
  key: "a",
  type: "attachment",
  url: "https://ugs.swu.edu.cn/file.xlsx",
  name: "考试安排.xlsx",
  fileType: "xlsx",
  iconSrc: "icon.gif",
};
const detail = {
  title: "通知",
  contentHtml: "<p>通知</p>",
  contentBlocks: [
    {
      key: "html",
      type: "html",
      contentHtml: "<p>正文</p>",
      segments: [
        {
          key: "1",
          type: "image",
          src: "https://ugs.swu.edu.cn/1.jpg",
          alt: "图片一",
        },
        attachment,
      ],
    },
    {
      key: "list",
      type: "list",
      markerWidthEm: 1.3,
      items: [
        {
          key: "li",
          marker: "1.",
          contentHtml: "<p>列表</p>",
          segments: [
            {
              key: "2",
              type: "image",
              src: "https://ugs.swu.edu.cn/2.jpg",
              alt: "图片二",
            },
            {
              key: "3",
              type: "image",
              src: "https://ugs.swu.edu.cn/1.jpg",
              alt: "图片一",
            },
          ],
        },
      ],
    },
  ],
};
let current = true;
let definition;
let menu;
let downloads = 0;
let nativeToastHidden = 0;
let clipboardError = false;
const previews = [],
  documents = [],
  shares = [],
  copies = [],
  toasts = [],
  removed = [];
const wx = {
  previewImage: (options) => previews.push(options),
  showActionSheet: (options) => {
    menu = options;
  },
  showLoading() {},
  hideLoading() {},
  hideToast() {
    nativeToastHidden += 1;
  },
  showToast: (options) => toasts.push(options),
  showModal() {},
  openDocument: (options) => documents.push(options),
  shareFileMessage: (options) => shares.push(options),
  setClipboardData: (options) => {
    copies.push(options.data);
    if (clipboardError) options.fail?.();
    else options.success?.();
    options.complete?.();
  },
};
const stubs = {
  "../../../utils/app-share": { buildAppShare() {} },
  "../../../services/teaching": {
    getNoticeDetail: async () => ({ data: detail, meta: {} }),
  },
  "../../../services/request": { getErrorMessage: (error) => error.message },
  "../../../utils/appearance": { resolveAppearance: () => ({}) },
  "../../../utils/date": { formatDateTime: (value) => value },
  "../../../utils/haptics": { haptic() {} },
  "../../../utils/navigation": { ensureAuthenticated: () => true },
  "../../../store/session": {
    captureSessionLease: () => ({}),
    isSessionLeaseCurrent: () => current,
  },
  "../../utils/notice-attachments": {
    canPreviewAttachment: (type) => /^(?:docx?|xlsx?|pptx?|pdf)$/.test(type),
    downloadNoticeAttachment: async () => {
      downloads += 1;
      return "wxfile://attachment";
    },
    removeAttachmentFile: (file) => removed.push(file),
  },
};
new Function("require", "Page", "wx", "exports", output)(
  (name) => {
    if (!stubs[name]) throw new Error(`Unexpected dependency ${name}`);
    return stubs[name];
  },
  (page) => {
    definition = page;
  },
  wx,
  {},
);
const page = {
  ...definition,
  data: structuredClone(definition.data),
  setData(patch) {
    Object.assign(this.data, patch);
  },
  selectComponent(selector) {
    assert.equal(selector, "#refresh-confirmation");
    return { show: (message) => toasts.push({ title: message, custom: true }) };
  },
};
const event = (dataset) => ({ currentTarget: { dataset } });

async function run() {
  page.data.id = "ugs:1012:4526";
  await page.loadDetail();
  assert.deepEqual(page.data.imageUrls, [
    "https://ugs.swu.edu.cn/1.jpg",
    "https://ugs.swu.edu.cn/2.jpg",
  ]);
  page.previewImage(event({ src: page.data.imageUrls[1] }));
  assert.equal(previews[0].current, page.data.imageUrls[1]);
  assert.deepEqual(previews[0].urls, page.data.imageUrls);
  page.previewImage(event({ src: "icon.gif" }));
  assert.equal(previews.length, 1);
  page.openAttachment(event({ url: attachment.url }));
  assert.deepEqual(menu.itemList, ["预览", "转发文件", "复制链接"]);
  menu.success({ tapIndex: 2 });
  assert.equal(copies.at(-1), attachment.url);
  assert.equal(toasts.at(-1).title, "已复制链接");
  assert.equal(toasts.at(-1).custom, true);
  assert.equal(toasts.length, 1);
  assert.equal(nativeToastHidden, 1);
  assert.equal(downloads, 0);
  page.data.selectedAttachment = attachment;
  page.data.attachmentAction = "share";
  const firstShare = page.performAttachmentAction();
  assert.equal(shares.length, 0);
  await firstShare;
  assert.equal(shares.length, 0, "Downloading must not invoke the share API");
  assert.deepEqual(menu.itemList, ["转发文件"]);
  current = false;
  menu.success({ tapIndex: 0 });
  assert.equal(shares.length, 0, "A stale download menu must not share files");
  current = true;
  menu.success({ tapIndex: 0 });
  assert.equal(
    shares.length,
    1,
    "A fresh tap must synchronously share the file",
  );
  page.data.attachmentAction = "preview";
  await page.performAttachmentAction();
  assert.equal(documents[0].filePath, "wxfile://attachment");
  assert.equal(documents[0].fileType, "xlsx");
  assert.equal(documents[0].showMenu, true);
  page.data.attachmentAction = "share";
  const cachedShare = page.performAttachmentAction();
  assert.equal(shares.length, 2, "Cached files must share before any await");
  await cachedShare;
  assert.equal(shares[0].fileName, attachment.name);
  assert.equal(downloads, 1);
  shares[0].fail({
    errMsg:
      "shareFileMessage:fail 开发者工具暂时不支持此 API 调试，请使用真机进行开发",
  });
  assert.equal(toasts.at(-1).title, "请在手机微信中转发文件");
  shares[0].fail({ errMsg: "shareFileMessage:fail network error" });
  assert.equal(toasts.at(-1).title, "转发失败，请重试");
  const feedbackCount = toasts.length;
  shares[0].fail({ errMsg: "shareFileMessage:fail cancel" });
  assert.equal(toasts.length, feedbackCount);
  documents[0].fail({ errMsg: "openDocument:fail invalid file" });
  assert.equal(toasts.at(-1).title, "附件预览失败，请重试");
  page.data.attachments = [{ ...attachment, fileType: "zip" }];
  page.openAttachment(event({ url: attachment.url }));
  assert.deepEqual(menu.itemList, ["转发文件", "复制链接"]);
  current = false;
  menu.success({ tapIndex: 1 });
  assert.equal(copies.length, 1);
  current = true;
  clipboardError = true;
  page.copyUrl(attachment.url);
  assert.equal(toasts.at(-1).title, "复制失败，请重试");
  page.onUnload();
  assert.deepEqual(removed, ["wxfile://attachment"]);
  assert.equal((template.match(/bindtap="previewImage"/g) || []).length, 2);
  assert.equal((template.match(/bindtap="openAttachment"/g) || []).length, 2);
  assert(!source.includes("captcha"));
  assert(!source.includes("wx.showToast") && !source.includes("wx.showModal"));
  assert(!source.includes("setTimeout"));
  assert(template.includes('<refresh-confirmation id="refresh-confirmation"'));
  console.log("Notice image, attachment menu and clipboard checks passed.");
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
