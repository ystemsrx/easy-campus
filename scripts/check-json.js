const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const appConfigPath = path.join(projectRoot, "miniprogram", "app.json");
const ignoredDirectories = new Set([".git", "node_modules", "miniprogram_npm"]);
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

    if (!entry.name.endsWith(".json")) {
      continue;
    }

    try {
      const value = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      if (fullPath === appConfigPath) {
        const description = value.permission?.["scope.userLocation"]?.desc;
        if (
          value.permission?.["scope.userLocation"] &&
          (typeof description !== "string" ||
            !description.trim() ||
            Array.from(description).length > 30)
        ) {
          failures.push(
            "miniprogram/app.json: scope.userLocation.desc 必须为非空字符串且不超过 30 字，否则微信预览上传会失败（80058）",
          );
        }
      }
    } catch (error) {
      failures.push(
        `${path.relative(projectRoot, fullPath)}: ${error.message}`,
      );
    }
  }
}

visit(projectRoot);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("All JSON files and location permission descriptions are valid.");
}
