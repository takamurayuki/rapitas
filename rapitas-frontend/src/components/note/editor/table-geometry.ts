/**
 * table-geometry
 *
 * Where a table's columns and rows sit on screen, so handles can be drawn
 * over them. Pure measurement — it does not render, and it does not change
 * the table (see `table-ops` for that).
 *
 * The handles are an overlay rather than elements inside the table: the
 * editor is a raw contentEditable whose innerHTML is the saved note, so
 * anything injected into the table would be persisted into the document.
 */

/** A column's horizontal extent, in viewport coordinates. */
export interface ColumnBand {
  /** 0-based column index. / 列番号 */
  index: number;
  left: number;
  width: number;
}

/** A row's vertical extent, in viewport coordinates. */
export interface RowBand {
  /** 0-based index among the rows handles are offered for. / 行番号 */
  index: number;
  top: number;
  height: number;
  /** True for the heading row, which cannot be deleted on its own. / 見出し行か */
  isHeader: boolean;
}

/** Everything the overlay needs to place itself over one table. */
export interface TableGeometry {
  /** The table's own box. / 表の矩形 */
  rect: { top: number; left: number; width: number; height: number };
  columns: ColumnBand[];
  rows: RowBand[];
}

/** A rect reader, injected so the measurement can be tested without layout. */
export type RectOf = (el: Element) => { top: number; left: number; width: number; height: number };

const domRect: RectOf = (el) => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

/**
 * Every row of a table, heading row first, in visual order.
 *
 * `table.rows` already does this, but only for rows the browser has placed
 * in a section; building it from thead+tbody keeps the heading flag honest
 * for a table whose rows were inserted by `table-ops`.
 *
 * @param table - The table to walk / 対象の表
 * @returns Each row with whether it is the heading row / 行と見出しフラグ
 */
export function orderedRows(
  table: HTMLTableElement,
): { row: HTMLTableRowElement; isHeader: boolean }[] {
  const head = Array.from(table.tHead?.rows ?? []).map((row) => ({ row, isHeader: true }));
  // Every tbody, not just the first: a pasted table can carry several, and
  // measuring one section would leave the rest without handles (#1062).
  const body = Array.from(table.tBodies)
    .flatMap((section) => Array.from(section.rows))
    .map((row) => ({ row, isHeader: false }));
  return [...head, ...body];
}

/**
 * Whether any cell spans more than one row or column.
 *
 * Measured 2026-10-18 (#1062): a table pasted with `colspan` measures the
 * right number of columns but the operations address cells by `cellIndex`,
 * which does not count spans — so inserting "to the right of column 2" can
 * land somewhere else entirely in a spanned row. Handling spans properly
 * needs a real grid model; until then the controls decline to act rather
 * than quietly mangling the table.
 *
 * @param table - The table to inspect / 対象の表
 * @returns True when a cell spans / 結合セルがあれば true
 */
export function hasSpannedCells(table: HTMLTableElement): boolean {
  return Array.from(table.rows).some((row) =>
    Array.from(row.cells).some((cell) => cell.colSpan > 1 || cell.rowSpan > 1),
  );
}

/**
 * Measure a table's columns and rows.
 *
 * Columns are measured from the widest row rather than the first: a table
 * mid-edit can have a row with fewer cells, and taking the first row would
 * then drop handles for columns that exist.
 *
 * @param table - The table to measure / 計測する表
 * @param rectOf - Rect reader; defaults to getBoundingClientRect / 矩形取得
 * @returns The bands to draw handles over, or null when the table is empty / 描画位置
 */
export function measureTable(
  table: HTMLTableElement,
  rectOf: RectOf = domRect,
): TableGeometry | null {
  const rows = orderedRows(table);
  if (rows.length === 0) return null;
  if (hasSpannedCells(table)) return null;

  const widest = rows.reduce(
    (best, r) => (r.row.cells.length > best.row.cells.length ? r : best),
    rows[0],
  );
  if (widest.row.cells.length === 0) return null;

  const columns: ColumnBand[] = Array.from(widest.row.cells).map((cell, index) => {
    const r = rectOf(cell);
    return { index, left: r.left, width: r.width };
  });

  const rowBands: RowBand[] = rows.map((entry, index) => {
    const r = rectOf(entry.row);
    return { index, top: r.top, height: r.height, isHeader: entry.isHeader };
  });

  return { rect: rectOf(table), columns, rows: rowBands };
}

/**
 * Whether a table's last deletable row or column is about to go.
 *
 * `table-ops` removes the whole table in that case, which is correct but is
 * not what someone clicking "delete row" expects to happen silently — the
 * caller uses this to say so first.
 *
 * @param table - The table being edited / 対象の表
 * @param axis - Which axis is being deleted / 削除する軸
 * @returns True when the deletion would remove the table / 表ごと消えるなら true
 */
export function deletionRemovesTable(table: HTMLTableElement, axis: 'row' | 'column'): boolean {
  const body = Array.from(table.tBodies).flatMap((s) => Array.from(s.rows));
  if (axis === 'row') return body.length <= 1;
  const header = table.tHead?.rows[0];
  const widest = header ?? body[0];
  return (widest?.cells.length ?? 0) <= 1;
}
