const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
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
      JSON.parse(fs.readFileSync(fullPath, "utf8"));
    } catch (error) {
      failures.push(`${path.relative(projectRoot, fullPath)}: ${error.message}`);
    }
  }
}

visit(projectRoot);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("All JSON files are valid.");
}
