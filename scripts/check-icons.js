const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const miniprogramRoot = path.join(projectRoot, "miniprogram");
const iconRoot = path.join(miniprogramRoot, "assets", "icons");
const tones = ["ink", "muted", "white", "coral", "amber", "sage", "rose", "danger"];
const usedNames = new Set(["circle-help", "eye", "eye-off"]);
const failures = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(fullPath);
      continue;
    }
    if (!entry.name.endsWith(".wxml") && !entry.name.endsWith(".ts")) continue;
    const source = fs.readFileSync(fullPath, "utf8");
    const patterns = [
      /<lucide-icon\b[^>]*\bname="(?!\{\{)([a-z0-9-]+)"/g,
      /<empty-state\b[^>]*\bicon="([a-z0-9-]+)"/g,
      /\bicon:\s*"(?!none"|success"|loading")([a-z0-9-]+)"/g,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(source))) usedNames.add(match[1]);
    }
  }
}

if (!fs.existsSync(iconRoot)) {
  failures.push("miniprogram/assets/icons 不存在");
} else {
  visit(miniprogramRoot);
  for (const name of usedNames) {
    for (const tone of tones) {
      const relativePath = `assets/icons/${name}-${tone}.svg`;
      const fullPath = path.join(miniprogramRoot, relativePath);
      if (!fs.existsSync(fullPath)) {
        failures.push(`${relativePath}: 图标资源缺失`);
        continue;
      }
      const source = fs.readFileSync(fullPath, "utf8");
      if (!source.includes("<svg") || source.includes("currentColor")) {
        failures.push(`${relativePath}: SVG 未固定描边色，无法作为 image 稳定渲染`);
      }
    }
  }
}

const projectConfig = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "project.config.json"), "utf8"),
);
if (projectConfig.setting?.ignoreUploadUnusedFiles !== false) {
  failures.push("project.config.json: 必须打包动态引用的 Lucide 图标资源");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Lucide icon checks passed (${usedNames.size} used icons).`);
}
