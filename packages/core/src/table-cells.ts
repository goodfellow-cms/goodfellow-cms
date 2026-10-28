/** A table's cells: rows of text, as the Table block keeps them. */
export type TableCells = string[][];

/** Cells as they're kept: rows of text, every row as long as the longest, never empty. */
export function tableCells(value: unknown): TableCells {
  const rows = Array.isArray(value)
    ? value.map((row) => (Array.isArray(row) ? row.map((cell) => (typeof cell === "string" ? cell : "")) : []))
    : [];
  const width = Math.max(1, ...rows.map((row) => row.length));
  const filled = rows.map((row) => [...row, ...Array<string>(width - row.length).fill("")]);
  return filled.length > 0 ? filled : [Array<string>(width).fill("")];
}
