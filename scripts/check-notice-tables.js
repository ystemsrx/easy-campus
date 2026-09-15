const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "../miniprogram");
const source = fs.readFileSync(
  path.join(root, "features/utils/notice-table-layout.ts"),
  "utf8",
);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleOutput = {};
new Function("exports", output)(moduleOutput);
const { layoutNoticeTable } = moduleOutput;
const table = {
  rowCount: 3,
  columnCount: 3,
  cells: [
    { key: "header", row: 0, column: 0, rowSpan: 1, colSpan: 3 },
    { key: "a", row: 1, column: 0, rowSpan: 1, colSpan: 1 },
    { key: "b", row: 1, column: 1, rowSpan: 1, colSpan: 1 },
    { key: "remarks", row: 1, column: 2, rowSpan: 2, colSpan: 1 },
    { key: "c", row: 2, column: 0, rowSpan: 1, colSpan: 1 },
    { key: "d", row: 2, column: 1, rowSpan: 1, colSpan: 1 },
  ],
};
for (const viewport of [240, 320, 768]) {
  for (const scale of [1, 1.5, 2]) {
    const heights = [50, 64, 24, 350, 80, 30].map((height) => height * scale);
    const layout = layoutNoticeTable(table, viewport, heights);
    assert(layout.width >= viewport);
    for (const [index, cell] of layout.cells.entries()) {
      assert(cell.width >= 144);
      assert(
        cell.height >= heights[index] + 26,
        "Long or enlarged text must fit without clipping",
      );
      assert(
        cell.top + cell.height < layout.height,
        "The last row must fit the scroll viewport",
      );
      assert(
        cell.left + cell.width < layout.width,
        "Rightmost column must be reachable",
      );
    }
    const [header, a, b, remarks, c, d] = layout.cells;
    assert.equal(header.width, layout.width - 1);
    assert.equal(a.top, header.height);
    assert.equal(a.height, b.height);
    assert.equal(c.top, a.top + a.height);
    assert.equal(remarks.top, a.top);
    assert.equal(remarks.height, a.height + c.height);
    assert.equal(remarks.top + remarks.height, d.top + d.height);
    assert.deepEqual(
      layoutNoticeTable(table, layout.width - 1, heights),
      layout,
      "Measurement must converge",
    );
  }
}
console.log(
  "Notice table merged cells, narrow viewport and expanded text checks passed.",
);
