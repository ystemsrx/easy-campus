const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const ignoredDirectories = new Set([".git", "node_modules", "miniprogram_npm"]);
const textExtensions = new Set([
  ".css",
  ".d.ts",
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".js",
  ".json",
  ".md",
  ".svg",
  ".ts",
  ".wxml",
  ".wxss",
]);
const failures = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(fullPath);
      continue;
    }

    const extension = path.extname(entry.name) || entry.name;
    if (!textExtensions.has(extension)) {
      continue;
    }

    if (fs.readFileSync(fullPath).includes(Buffer.from("\r\n"))) {
      failures.push(path.relative(projectRoot, fullPath));
    }
  }
}

visit(projectRoot);

if (failures.length > 0) {
  console.error(`以下文件不是 LF：\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("All text files use LF line endings.");
}
