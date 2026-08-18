const fs = require("node:fs");
const path = require("node:path");

const miniprogramRoot = path.resolve(__dirname, "..", "miniprogram");
const failures = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(fullPath);
      continue;
    }
    if (!entry.name.endsWith(".wxss")) {
      continue;
    }

    const source = fs.readFileSync(fullPath, "utf8");
    const relativePath = path.relative(miniprogramRoot, fullPath);
    const blockPattern = /([^{}]+)\{([^{}]*)\}/g;
    let match;
    while ((match = blockPattern.exec(source))) {
      const selector = match[1].trim();
      const declarations = match[2];
      if (
        /title/i.test(selector) &&
        /\bcolor\s*:\s*currentColor\s*;/i.test(declarations)
      ) {
        failures.push(
          `${relativePath}: 标题 ${selector} 不得依赖 currentColor，必须声明明确的亮色和暗色`,
        );
      }
    }
  }
}

visit(miniprogramRoot);

const requiredTitleColors = [
  {
    file: "components/navigation-bar/navigation-bar.wxss",
    light: /\.nav-title\s*\{[^}]*color:\s*#16161a;/,
    dark: /\.nav-shell--dark \.nav-title\s*\{[^}]*color:\s*#f7f3e9;/,
  },
  {
    file: "components/bottom-sheet/bottom-sheet.wxss",
    light: /\.sheet-title\s*\{[^}]*color:\s*#16161a;/,
    dark: /\.sheet-layer--dark \.sheet-title\s*\{[^}]*color:\s*#f7f3e9;/,
  },
  {
    file: "pages/pass-rates/index.wxss",
    light: /\.pass-picker-title\s*\{[^}]*color:\s*#16161a;/,
    dark: /\.theme-dark \.pass-picker-title\s*\{[^}]*color:\s*#f7f3e9;/,
  },
  {
    file: "pages/rooms/index.wxss",
    light: /\.period-picker-title\s*\{[^}]*color:\s*#16161a;/,
    dark: /\.theme-dark \.period-picker-title\s*\{[^}]*color:\s*#f7f3e9;/,
  },
];

for (const expectation of requiredTitleColors) {
  const source = fs.readFileSync(
    path.join(miniprogramRoot, expectation.file),
    "utf8",
  );
  if (!expectation.light.test(source) || !expectation.dark.test(source)) {
    failures.push(`${expectation.file}: 核心标题必须同时声明明确的亮色和暗色`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Title visibility checks passed.");
}
