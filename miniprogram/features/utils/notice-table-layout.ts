import type { NoticeTable } from "../../types/api";

// Measure natural cell content first, then share any extra height across the
// rows it spans. Absolute cell boxes preserve both rowspan and colspan.
export function layoutNoticeTable(
  table: NoticeTable,
  availableWidth: number,
  contentHeights: number[] = [],
) {
  const columnWidth = Math.max(
    144,
    availableWidth / Math.max(1, table.columnCount),
  );
  const heights = Array.from({ length: table.rowCount }, () => 56);
  const bySpan = table.cells
    .map((cell, index) => ({ cell, index }))
    .sort((a, b) => a.cell.rowSpan - b.cell.rowSpan);
  for (const { cell, index } of bySpan) {
    const needed = Math.ceil(contentHeights[index] || 0) + 26;
    const current = heights
      .slice(cell.row, cell.row + cell.rowSpan)
      .reduce((sum, height) => sum + height, 0);
    const extra = Math.max(0, needed - current) / cell.rowSpan;
    for (let row = cell.row; row < cell.row + cell.rowSpan; row += 1) {
      heights[row] += extra;
    }
  }
  const offsets = [0];
  heights.forEach((height) =>
    offsets.push(offsets[offsets.length - 1] + height),
  );
  return {
    width: columnWidth * table.columnCount + 1,
    height: offsets[offsets.length - 1] + 1,
    cells: table.cells.map((cell) => ({
      ...cell,
      left: cell.column * columnWidth,
      top: offsets[cell.row],
      width: cell.colSpan * columnWidth,
      height: offsets[cell.row + cell.rowSpan] - offsets[cell.row],
    })),
  };
}
