const fs = require("node:fs");
const path = require("node:path");

// Inspect each shared body once, at its first invocation. The native compiler
// still validates each real template call, including its explicit data scope.
function readSource(file, encoding) {
  if (path.extname(String(file)) !== ".wxml" || encoding !== "utf8")
    return fs.readFileSync(file, encoding);
  const visited = new Set();
  function expand(current, stack = []) {
    current = path.resolve(current);
    if (stack.includes(current))
      throw new Error("Cyclic WXML dependency: " + current);
    if (visited.has(current)) return "";
    visited.add(current);
    let source = fs.readFileSync(current, "utf8");
    const templates = new Map();
    source = source.replace(/<import\s+src="([^"]+)"\s*\/>/g, (_, relative) => {
      const imported = path.resolve(path.dirname(current), relative);
      const text = fs.readFileSync(imported, "utf8");
      for (const match of text.matchAll(
        /<template\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/template>/g,
      ))
        templates.set(match[1], { file: imported, body: match[2] });
      return "";
    });
    source = source.replace(
      /<template\s+is="([^"]+)"[^>]*\/>/g,
      (tag, name) => {
        const template = templates.get(name);
        if (!template) return tag;
        const key = template.file + "#" + name;
        if (visited.has(key)) return "";
        visited.add(key);
        return template.body;
      },
    );
    return source.replace(/<include\s+src="([^"]+)"\s*\/>/g, (_, relative) =>
      expand(path.resolve(path.dirname(current), relative), [
        ...stack,
        current,
      ]),
    );
  }
  return expand(file);
}
module.exports = { readSource };
