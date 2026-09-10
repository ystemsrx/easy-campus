const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "../miniprogram");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const paletteRules = [
  ...read("styles/pass-rate-palette.wxss").matchAll(/([^{}]+)\{([^}]+)\}/g),
];
function palette(theme, visualTheme) {
  const classes = new Set(["pass-rate-card", `pass-rate-card--${visualTheme}`]);
  if (theme === "dark") classes.add("pass-rate-card--dark");
  const colors = {};
  for (const [, selectors, declarations] of paletteRules) {
    if (
      !selectors.split(",").some((selector) => {
        const names = [...selector.matchAll(/\.([\w-]+)/g)].map(
          (match) => match[1],
        );
        return names.length && names.every((name) => classes.has(name));
      })
    )
      continue;
    for (const [, name, value] of declarations.matchAll(
      /--pass-([\w-]+):\s*(#[a-f\d]+);/gi,
    ))
      colors[name] = value;
  }
  return colors;
}
function luminance(hex) {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (light + 0.05) / (dark + 0.05);
}

let component;
vm.runInNewContext(
  ts.transpileModule(read("components/pass-rate-card/pass-rate-card.ts"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText,
  {
    exports: {},
    Component: (value) => {
      component = value;
    },
  },
);

const instance = {
  data: {
    ...component.data,
    ...Object.fromEntries(
      Object.entries(component.properties).map(([name, prop]) => [
        name,
        prop.value,
      ]),
    ),
    statistics: {
      totalCount: 40,
      passedCount: 36,
      failedCount: 4,
      passRate: 90,
      distribution: [{ band: "80–89", count: 40 }],
      scores: [{ score: "84", count: 40 }],
    },
    ownScore: 84,
  },
  setData(update) {
    Object.assign(this.data, update);
  },
};
for (const visualTheme of ["default", "soft", "minimal"]) {
  for (const theme of ["light", "dark"]) {
    const colors = palette(theme, visualTheme);
    const label = `${theme}/${visualTheme}`;
    for (const [foreground, background] of [
      ["text", "surface"],
      ["secondary", "surface"],
      ["muted", "surface"],
      ["muted", "bg"],
      ["hero-text", "hero-from"],
      ["hero-muted", "hero-from"],
      ["hero-muted", "hero-to"],
      ["accent", "accent-soft"],
      ["success", "success-soft"],
      ["danger", "danger-soft"],
    ])
      assert(
        contrast(colors[foreground], colors[background]) >= 4.5,
        `${label}: ${foreground}/${background} text contrast is too low`,
      );
    assert(
      contrast(colors.accent, colors.track) >= 3,
      `${label}: highlighted bars must stand out from their track`,
    );
    assert(
      contrast(colors.success, colors["success-track"]) >= 3,
      `${label}: pass-rate progress must stand out from its track`,
    );

    Object.assign(instance.data, { theme, visualTheme, reducedMotion: true });
    component.methods.refreshStatistics.call(instance);
    const svg = decodeURIComponent(instance.data.passRingSource.split(",")[1]);
    assert(
      svg.includes(`stroke="${colors.success}"`),
      `${label}: ring and passed status differ after a theme change`,
    );
    assert(
      svg.includes(`stroke="${colors["success-track"]}"`),
      `${label}: ring must use the success track after a theme change`,
    );
    assert(
      svg.includes('stroke-dasharray="237.5 26.39"'),
      `${label}: theme changes must preserve the 90% ring`,
    );
    assert(
      !svg.includes("<animate"),
      `${label}: reduced motion must remain respected`,
    );
    assert.equal(instance.data.distribution[0].mine, true);
    assert.equal(instance.data.scoreEntries[0].mine, true);
  }
}
for (const name of [
  "sparkles",
  "check",
  "chart-no-axes-column-increasing",
  "chevron-right",
  "circle-alert",
]) {
  for (const theme of ["light", "dark"]) {
    const role = name === "circle-alert" ? "danger" : "blue";
    const tone = `pass-${role}${theme === "dark" ? "-dark" : ""}`;
    const icon = read(`assets/icons/${name}-${tone}.svg`);
    const expected = palette(theme, "default")[
      role === "blue" ? "accent" : "danger"
    ];
    assert(
      icon.includes(`stroke="${expected}"`),
      `${name}/${theme}: packaged icon must match its status color`,
    );
  }
}
console.log(
  "Pass-rate colors passed: six theme palettes, text contrast, ring/theme updates, score highlights and packaged icons.",
);
