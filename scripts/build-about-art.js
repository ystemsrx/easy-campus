const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..", "miniprogram", "features");
const source = fs.readFileSync(
  path.join(root, "utils", "about-art.ts"),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const artModule = { exports: {} };
new Function("exports", compiled)(artModule.exports);
const paths = artModule.exports.REST_ART.map(
  ({ commands, fill, stroke, width }) =>
    `  <path d="${commands.map((command) => command.join(" ")).join(" ")}" fill="${fill || "none"}"${stroke ? ` stroke="${stroke}" stroke-width="${width}"` : ""}/>`,
);
const assetPath = path.join(root, "assets", "about-rest.svg");
fs.mkdirSync(path.dirname(assetPath), { recursive: true });
fs.writeFileSync(
  assetPath,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 450 260">\n${paths.join("\n")}\n</svg>\n`,
);
console.log("Built the About artwork from the shared print geometry.");
