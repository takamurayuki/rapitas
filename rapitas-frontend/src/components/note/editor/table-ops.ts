/**
 * table-ops
 *
 * Row and column surgery on a table already in the editor's contentEditable
 * area. Pure DOM, no React and no selection handling — callers resolve the
 * caret to a cell and decide what to do with the cursor afterwards.
 */

/** Names a heading by its 1-based column position. */
export type HeadingNamer = (position: number) => string;

/** Where a new row goes relative to the caret's row. */
export type RowSide = 'above' | 'below';

/** Where a new column goes relative to the caret's column. */
export type ColumnSide = 'left' | 'right';

/**
 * The table cell containing `node`, as long as its table is inside `root`.
 *
 * The root check is what keeps a toolbar action from reaching a table that
 * happens to be elsewhere on the page when the editor has no selection of its
 * own.
 *
 * @param node - Node at the caret / カーソル位置のノード
 * @param root - The editor's contentEditable element / エディタのルート要素
 * @returns The cell, or null when the caret is not in one / セル、無ければ null
 */
export function findTableCell(
  node: Node | null,
  root: HTMLElement | null,
): HTMLTableCellElement | null {
  if (!node || !root) return null;
  const start = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const cell = start?.closest('td, th') ?? null;
  if (!cell || !root.contains(cell)) return null;
  return cell as HTMLTableCellElement;
}

/**
 * Every body row of a table, across all `tbody` sections.
 *
 * Measured 2026-10-18 (#1062): a pasted table can carry more than one
 * `tbody`, and operating on `tBodies[0]` alone added a cell to the first
 * section only — leaving rows of different widths.
 *
 * @param table - The table to walk / 対象の表
 * @returns Body rows in document order / 本体行
 */
function bodyRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return Array.from(table.tBodies).flatMap((body) => Array.from(body.rows));
}

/** The table a cell belongs to. */
function tableOf(cell: HTMLTableCellElement): HTMLTableElement | null {
  return cell.closest('table');
}

/** An empty body cell — a `<br>` keeps it focusable and sized like the others. */
function emptyCell(): HTMLTableCellElement {
  const td = document.createElement('td');
  td.appendChild(document.createElement('br'));
  return td;
}

/** Re-number every heading so positions stay consistent after an insert. */
function renumberHeadings(table: HTMLTableElement, name: HeadingNamer): void {
  const headRow = table.tHead?.rows[0];
  if (!headRow) return;
  Array.from(headRow.cells).forEach((th, i) => {
    th.textContent = name(i + 1);
  });
}

/**
 * Insert an empty row above or below the caret's row.
 *
 * @param cell - A cell in the caret's row / カーソル行のセル
 * @param side - Which side to insert on / 挿入する側
 */
export function insertRow(cell: HTMLTableCellElement, side: RowSide): void {
  const row = cell.closest('tr');
  const body = row?.parentElement;
  const table = tableOf(cell);
  if (!row || !body || !table) return;

  const columns = table.tHead?.rows[0]?.cells.length ?? row.cells.length;
  const tr = document.createElement('tr');
  for (let c = 0; c < columns; c++) tr.appendChild(emptyCell());

  // A caret in the heading row has no row below it inside tbody, so either
  // side there would land in thead. Put the row at the top of the body.
  if (row.parentElement === table.tHead) {
    (table.tBodies[0] ?? table).prepend(tr);
    return;
  }
  row.insertAdjacentElement(side === 'above' ? 'beforebegin' : 'afterend', tr);
}

/**
 * Insert an empty column to the left or right of the caret's column.
 *
 * @param cell - A cell in the caret's column / カーソル列のセル
 * @param side - Which side to insert on / 挿入する側
 * @param name - Names the heading of each column by position / 見出しの命名
 */
export function insertColumn(
  cell: HTMLTableCellElement,
  side: ColumnSide,
  name: HeadingNamer,
): void {
  const table = tableOf(cell);
  if (!table) return;
  const at = cell.cellIndex + (side === 'right' ? 1 : 0);

  const headRow = table.tHead?.rows[0];
  if (headRow) {
    const th = document.createElement('th');
    headRow.insertBefore(th, headRow.cells[at] ?? null);
  }
  for (const row of bodyRows(table)) {
    row.insertBefore(emptyCell(), row.cells[at] ?? null);
  }
  renumberHeadings(table, name);
}

/** Remove the table a cell belongs to. */
export function deleteTable(cell: HTMLTableCellElement): void {
  tableOf(cell)?.remove();
}

/**
 * Remove the caret's row, or the whole table when it was the last body row.
 *
 * A heading row with no body behind it is not a table anyone wants left in
 * their document.
 *
 * @param cell - A cell in the row to remove / 削除する行のセル
 */
export function deleteRow(cell: HTMLTableCellElement): void {
  const row = cell.closest('tr');
  const table = tableOf(cell);
  if (!row || !table) return;
  if (bodyRows(table).length <= 1) {
    table.remove();
    return;
  }
  row.remove();
}

/**
 * Remove the caret's column, or the whole table when it was the last one.
 *
 * @param cell - A cell in the column to remove / 削除する列のセル
 */
export function deleteColumn(cell: HTMLTableCellElement): void {
  const table = tableOf(cell);
  if (!table) return;
  const at = cell.cellIndex;
  const columns = table.tHead?.rows[0]?.cells.length ?? bodyRows(table)[0]?.cells.length ?? 0;
  if (columns <= 1) {
    table.remove();
    return;
  }
  table.tHead?.rows[0]?.cells[at]?.remove();
  for (const row of bodyRows(table)) row.cells[at]?.remove();
}
