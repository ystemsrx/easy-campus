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

const inboxTemplate = fs.readFileSync(
  path.join(miniprogramRoot, "pages", "inbox", "index.wxml"),
  "utf8",
);
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

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("WXML Skyline checks passed.");
}
