const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "miniprogram");
const appConfig = JSON.parse(
  fs.readFileSync(path.join(root, "app.json"), "utf8"),
);
const projectConfig = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "..", "project.config.json"), "utf8"),
);
const failures = [];
const TWO_MIB = 2 * 1024 * 1024;

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function byteSize(files) {
  return files.reduce((total, file) => total + fs.statSync(file).size, 0);
}

function pageFilesExist(route) {
  return ["json", "ts", "wxml", "wxss"].every((extension) =>
    fs.existsSync(path.join(root, `${route}.${extension}`)),
  );
}

const mainPages = new Set(appConfig.pages || []);
const subpackages = appConfig.subPackages || appConfig.subpackages || [];
const declaredRoutes = new Set(mainPages);
for (const subpackage of subpackages) {
  for (const page of subpackage.pages || []) {
    const route = `${subpackage.root}/${page}`;
    if (declaredRoutes.has(route)) failures.push(`页面重复注册：${route}`);
    declaredRoutes.add(route);
  }
}

for (const item of appConfig.tabBar?.list || []) {
  if (!mainPages.has(item.pagePath)) {
    failures.push(`TabBar 页面必须保留在主包：${item.pagePath}`);
  }
}
for (const route of declaredRoutes) {
  if (!pageFilesExist(route)) failures.push(`页面文件不完整：${route}`);
}

const featurePackage = subpackages.find(
  (subpackage) => subpackage.root === "features",
);
if (!featurePackage || featurePackage.independent === true) {
  failures.push("功能页必须注册为可复用主包公共代码的 features 普通分包");
}

const allFiles = walk(root);
const sourceFiles = allFiles.filter((file) =>
  /\.(?:ts|wxml|wxss|json)$/.test(file),
);
const routePattern = /["'`]\/(?:[\w-]+\/)*pages\/[\w-]+\/index/g;
const assetPattern = /["'`](\/(?:features\/)?assets\/[^"'`?\s}]+)/g;
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(routePattern)) {
    const route = match[0].slice(2);
    if (!declaredRoutes.has(route)) {
      failures.push(`${path.relative(root, file)} 引用了未注册页面：/${route}`);
    }
  }
  for (const match of source.matchAll(assetPattern)) {
    const assetPath = match[1].slice(1);
    if (
      !assetPath.includes("{{") &&
      !fs.existsSync(path.join(root, assetPath))
    ) {
      failures.push(
        `${path.relative(root, file)} 引用了不存在的资源：/${assetPath}`,
      );
    }
  }
}

for (const file of allFiles.filter((candidate) =>
  candidate.endsWith(".json"),
)) {
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const componentPath of Object.values(config.usingComponents || {})) {
    if (typeof componentPath !== "string" || !componentPath.startsWith("/")) {
      continue;
    }
    const componentBase = path.join(root, componentPath.slice(1));
    if (
      !["json", "ts", "wxml", "wxss"].every((extension) =>
        fs.existsSync(`${componentBase}.${extension}`),
      )
    ) {
      failures.push(
        `${path.relative(root, file)} 引用了不完整的组件：${componentPath}`,
      );
    }
  }
}

const featureRoot = path.join(root, "features");
const mainFiles = allFiles.filter(
  (file) =>
    file !== featureRoot && !file.startsWith(`${featureRoot}${path.sep}`),
);
const mainBytes = byteSize(mainFiles);
if (mainBytes >= TWO_MIB) {
  failures.push(`主包原始文件 ${mainBytes} 字节，必须低于 2 MiB`);
}
for (const subpackage of subpackages) {
  const packageRoot = path.join(root, subpackage.root);
  const packageBytes = byteSize(walk(packageRoot));
  if (packageBytes >= TWO_MIB) {
    failures.push(
      `${subpackage.root} 分包原始文件 ${packageBytes} 字节，必须低于 2 MiB`,
    );
  }
}

if (
  projectConfig.setting?.minified !== true ||
  projectConfig.setting?.ignoreUploadUnusedFiles !== true ||
  projectConfig.setting?.uploadWithSourceMap !== false ||
  !projectConfig.packOptions?.include?.some(
    (entry) => entry.type === "folder" && entry.value === "assets/icons",
  ) ||
  !projectConfig.packOptions?.include?.some(
    (entry) => entry.type === "folder" && entry.value === "assets/login",
  ) ||
  !projectConfig.packOptions?.include?.some(
    (entry) => entry.type === "folder" && entry.value === "features/assets",
  )
) {
  failures.push(
    "上传配置必须启用压缩、过滤未使用文件、显式保留动态资源并关闭生产源码映射",
  );
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Package boundary checks passed (main ${mainBytes} bytes, features ${byteSize(walk(featureRoot))} bytes).`,
  );
}
