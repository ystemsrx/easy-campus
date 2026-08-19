import fs from "node:fs";
import path from "node:path";

const sourcePath = process.argv[2];
if (!sourcePath) {
  throw new Error(
    "Usage: node scripts/generate-pet-engine-data.mjs <grok-bot-engine.js>",
  );
}

const source = fs.readFileSync(path.resolve(sourcePath), "utf8");
const start = source.indexOf("const Y3 =");
const end = source.indexOf(",\n  vzt = T.forwardRef");
if (start < 0 || end < 0 || end <= start) {
  throw new Error(
    "The supplied Grok Bot engine does not match the expected extraction format.",
  );
}

const factory = new Function(
  `${source.slice(start, end)}; return { Y3, al, got, XFt, rpe, Aqe, dzt };`,
);
const { Y3, al, got, XFt, rpe, Aqe, dzt } = factory();
const states = XFt.flatMap((group) => group.states);
const shapes = Object.fromEntries(
  got.map((id) => [
    id,
    {
      id,
      path: al[id].path,
      face: al[id].face,
      ring: al[id].ring,
      radius: al[id].radius,
      beltRadius: al[id].beltRadius,
      tiltScale: al[id].tiltScale,
      top: al[id].top,
      bottom: al[id].bottom,
      sides: al[id].sides,
      spanLeft: Array.from({ length: 160 }, (_, index) => {
        const y =
          al[id].top +
          ((al[id].bottom - al[id].top) * (index + 0.5)) / 160;
        return al[id].spanAt(y)[0];
      }),
      spanRight: Array.from({ length: 160 }, (_, index) => {
        const y =
          al[id].top +
          ((al[id].bottom - al[id].top) * (index + 0.5)) / 160;
        return al[id].spanAt(y)[1];
      }),
    },
  ]),
);

const output = `// Generated from the user-supplied Grok Bot 0.16.0 animation engine.\n// Run scripts/generate-pet-engine-data.mjs with the extracted engine to refresh.\n\nexport const PET_SHAPE_IDS = ${JSON.stringify(got)} as const;\n\nexport type PetShapeId = (typeof PET_SHAPE_IDS)[number];\n\nexport const PET_STATE_IDS = ${JSON.stringify(states)} as const;\n\nexport type PetStateId = (typeof PET_STATE_IDS)[number];\n\nexport interface PetFaceDefinition {\n  x: number;\n  y: number;\n  sx: number;\n  sy: number;\n  eye: number;\n  leftDX?: number;\n}\n\nexport interface PetShapeDefinition {\n  id: PetShapeId;\n  path: string;\n  face: PetFaceDefinition;\n  ring: readonly (readonly [number, number])[];\n  radius: number;\n  beltRadius: number;\n  tiltScale: number;\n  top: number;\n  bottom: number;\n  sides: number;\n  spanLeft: readonly number[];\n  spanRight: readonly number[];\n}\n\nexport const PET_SHAPE_DEFINITIONS: Record<PetShapeId, PetShapeDefinition> = ${JSON.stringify(shapes, null, 2)};\n\nexport const PET_EYE_TOPOLOGIES = ${JSON.stringify(Y3)} as const;\n\nexport const PET_STATE_EYES: Record<PetStateId, readonly number[]> = ${JSON.stringify(rpe, null, 2)};\n\nexport const PET_STATE_EYE_DELAYS: Record<PetStateId, readonly [number, number]> = ${JSON.stringify(Aqe, null, 2)};\n\nexport const PET_STATE_EFFECTS: Partial<Record<PetStateId, string>> = ${JSON.stringify(dzt, null, 2)};\n`;

const outputPath = path.resolve(
  "miniprogram/components/geometric-pet/engine-data.ts",
);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output, "utf8");
console.log(`Wrote ${outputPath}`);
