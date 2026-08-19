import fs from "node:fs";
import path from "node:path";

const sourcePath = process.argv[2];
if (!sourcePath) {
  throw new Error(
    "Usage: node scripts/generate-pet-engine-runtime.mjs <grok-bot-engine.js>",
  );
}

const projectRoot = path.resolve(import.meta.dirname, "..");
const adapter = fs.readFileSync(
  path.join(import.meta.dirname, "pet-engine-runtime-adapter.txt"),
  "utf8",
);
const wrapper = fs.readFileSync(
  path.join(import.meta.dirname, "pet-engine-runtime-wrapper.txt"),
  "utf8",
);
const extractedSource = fs
  .readFileSync(path.resolve(sourcePath), "utf8")
  .replace(/import React from "react";\r?\n/, "")
  .replace(/import \{ jsx, jsxs \} from "react\/jsx-runtime";\r?\n/, "")
  .replace(/\r?\nexport const GrokBotEngine = vzt;[\s\S]*$/, "\n");

const pausedResetSource = `for (const on of [Ne, _e, ce])
                ((on.x = 1), (on.v = 0), (on.t = 1));`;
const pausedResetReplacement = `for (const on of [Ne])
                ((on.x = 1), (on.v = 0), (on.t = 1));
              const __pausedEyeOpen = L.current ? 1.18 : 1,
                __pausedEyeScale = L.current ? 1.32 : 1;
              ((_e.x = __pausedEyeOpen),
                (_e.v = 0),
                (_e.t = __pausedEyeOpen),
                (ce.x = __pausedEyeScale),
                (ce.v = 0),
                (ce.t = __pausedEyeScale),
                (is = L.current ? 1 : 0));`;
const source = extractedSource.replace(
  pausedResetSource,
  pausedResetReplacement,
);

if (!source.includes("const Y3 =") || !source.includes("vzt = T.forwardRef")) {
  throw new Error(
    "The supplied Grok Bot engine does not match the expected extraction format.",
  );
}
if (source === extractedSource) {
  throw new Error(
    "The supplied Grok Bot engine does not expose the expected paused-frame reset.",
  );
}

const outputPath = path.join(
  projectRoot,
  "miniprogram",
  "components",
  "geometric-pet",
  "original-engine.ts",
);
fs.writeFileSync(
  outputPath,
  `${adapter.trimEnd()}\n\n${source.trim()}\n${wrapper.trimStart()}`,
  "utf8",
);
console.log(`Wrote ${outputPath}`);
