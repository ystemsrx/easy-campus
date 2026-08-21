const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const config = fs.readFileSync(
  path.join(projectRoot, "miniprogram", "config", "index.ts"),
  "utf8",
);
const productionOrigin = "https://easy-api.lazycampus.com";
const failures = [];

for (const environment of ["trial", "release"]) {
  if (!config.includes(`${environment}: "${productionOrigin}"`)) {
    failures.push(
      `${environment} 环境必须使用正式后端 ${productionOrigin}`,
    );
  }
}

if (
  config.includes("api.example.com") ||
  config.includes(`${productionOrigin}/api/v1`)
) {
  failures.push("环境域名不得保留占位地址或重复包含 /api/v1");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("API environment configuration checks passed.");
}
