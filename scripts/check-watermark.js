const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const miniprogram = path.join(root, "miniprogram");
const app = JSON.parse(fs.readFileSync(path.join(miniprogram, "app.json")));
const pages = [
  ...app.pages,
  ...app.subPackages.flatMap((subPackage) =>
    subPackage.pages.map((page) => `${subPackage.root}/${page}`),
  ),
];

assert.equal(
  app.usingComponents["screen-watermark"],
  "/components/screen-watermark/screen-watermark",
  "screen-watermark must be globally registered",
);

for (const page of pages) {
  const source = fs.readFileSync(
    path.join(miniprogram, `${page}.wxml`),
    "utf8",
  );
  assert.equal(
    source.match(/<screen-watermark>/g)?.length || 0,
    1,
    `${page} must contain exactly one screen-watermark`,
  );
}

const componentTemplate = fs.readFileSync(
  path.join(
    miniprogram,
    "components",
    "screen-watermark",
    "screen-watermark.wxml",
  ),
  "utf8",
);
assert.match(componentTemplate, /<root-portal/);
assert.match(componentTemplate, /aria-hidden="true"/);

const serviceSource = fs.readFileSync(
  path.join(miniprogram, "services", "watermark.ts"),
  "utf8",
);
assert.match(serviceSource, /"\/auth\/watermark"/);
assert.match(serviceSource, /signedInAt/);
assert.match(serviceSource, /active\?\.leaseKey/);
assert.doesNotMatch(serviceSource, /createScreenWatermarkSource\([^)]*account/);

const corePath = path.join(miniprogram, "utils", "watermark-core.ts");
const transpiled = ts.transpileModule(fs.readFileSync(corePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const coreModule = { exports: {} };
new Function("exports", "module", "require", transpiled)(
  coreModule.exports,
  coreModule,
  require,
);
const core = coreModule.exports;
const token = core.hexToBytes("00112233445566778899aabbccddeeff");
const packet = core.createWatermarkPacket(token, 1);
assert.equal(
  Buffer.from(packet).toString("hex"),
  "b17d111000112233445566778899aabbccddeeff8d2f",
  "watermark packet must stay compatible with the server reference encoder",
);
const signs = core.createWatermarkTileSigns(packet);
assert.equal(
  crypto.createHash("sha256").update(Buffer.from(signs)).digest("hex"),
  "a393dcf9fc4c040f35d22e4d0cac76d9c9273015f2f531595f47c3a6d095f9e2",
  "watermark layout must stay compatible with the server detector",
);

console.log(`Watermark checks passed for ${pages.length} pages.`);
