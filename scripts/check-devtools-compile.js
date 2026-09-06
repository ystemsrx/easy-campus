const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

// Run in the installed DevTools Electron runtime so its bundled compiler and
// exact Babel dependency versions are loaded directly from app.asar.
async function compileWithDevTools(archive) {
  const { bableCompile } = require(path.join(
    archive,
    "js/common/miniprogram-builder/modules/corecompiler/summer/plugins/script_task/babel_script_task.js",
  ));
  const project = JSON.parse(
    fs.readFileSync(path.join(root, "project.config.json"), "utf8"),
  );
  const settings = project.setting;
  const sourceRoot = path.resolve(root, project.miniprogramRoot);
  const options = {
    typescript: settings.useCompilerPlugins.includes("typescript"),
    enhance: Boolean(settings.enhance || settings.es6),
    compileWorklet: Boolean(settings.compileWorklet),
    disableUseStrict: Boolean(settings.disableUseStrict),
    babelRoot: "@babel/runtime",
  };
  const files = [];
  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(filename);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"))
        files.push(filename);
    }
  }
  collect(sourceRoot);
  const failures = [];
  for (const filename of files.sort()) {
    const reportError = console.error;
    try {
      // The compiler logs duplicate stacks before throwing. Report one failure
      // per source file below, while keeping the actual thrown error intact.
      console.error = () => {};
      const result = await bableCompile(
        filename,
        { sourceCode: fs.readFileSync(filename, "utf8"), inputMap: false },
        options,
      );
      if (!result.code) throw new Error("Compiler produced no JavaScript");
      new vm.Script(result.code, { filename });
    } catch (error) {
      failures.push(`${path.relative(sourceRoot, filename)}: ${error.message}`);
    } finally {
      console.error = reportError;
    }
  }
  if (failures.length) {
    console.error(failures.join("\n\n"));
    throw new Error(`DevTools compilation failed for ${failures.length} files`);
  }
  console.log(
    `DevTools compilation passed for ${files.length} TypeScript files (ES6 transforms: ${options.enhance}, Worklet: ${options.compileWorklet}).`,
  );
}

async function main() {
  if (process.argv[2] === "--worker") {
    await compileWithDevTools(process.argv[3]);
    return;
  }
  const executable = process.argv[2] || process.env.WECHAT_DEVTOOLS_EXECUTABLE;
  if (!executable) {
    throw new Error(
      'Usage: npm run check:devtools -- "<WeChat DevTools executable>" (or set WECHAT_DEVTOOLS_EXECUTABLE).',
    );
  }
  const resolvedExecutable = path.resolve(executable);
  const archive = path.join(
    path.dirname(resolvedExecutable),
    "resources",
    "app.asar",
  );
  if (!fs.existsSync(resolvedExecutable) || !fs.existsSync(archive)) {
    throw new Error("WeChat DevTools executable or resources/app.asar not found");
  }
  const result = spawnSync(
    resolvedExecutable,
    [__filename, "--worker", archive],
    {
      cwd: root,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
      windowsHide: true,
      timeout: 180000,
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
