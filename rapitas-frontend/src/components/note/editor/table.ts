/**
 * table
 *
 * Builds a table of a requested shape as a DocumentFragment.
 * Not responsible for inserting it, or for changing its shape afterwards —
 * see table-ops.ts for row and column surgery.
 */

import type { HeadingNamer } from './table-ops';

/** Largest table the size picker offers. */
export const MAX_TABLE_ROWS = 8;
export const MAX_TABLE_COLUMNS = 8;

/** The shape the caller asked for. */
export interface TableShape {
  rows: number;
  columns: number;
}

/** Keep a requested count inside 1..max, tolerating a non-finite value. */
function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

/**
 * Build a table of `shape`, wrapped in a DocumentFragment.
 *
 * A trailing empty paragraph is appended so the cursor can escape the table —
 * without it a table at the end of a note is a dead end.
 *
 * The shape is clamped rather than rejected: this runs from a picker whose
 * own grid already bounds the input, so an out-of-range value means a caller
 * bug, and inserting a usable table beats inserting nothing.
 *
 * @param shape - Body rows and columns to build / 本文の行数と列数
 * @param headingName - Names each heading by its 1-based position / 見出しの命名
 * @returns The fragment to insert / 挿入するフラグメント
 */
export function createTableNode(shape: TableShape, headingName: HeadingNamer): DocumentFragment {
  const rows = clamp(shape.rows, MAX_TABLE_ROWS);
  const columns = clamp(shape.columns, MAX_TABLE_COLUMNS);
  const frag = document.createDocumentFragment();

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (let c = 0; c < columns; c++) {
    const th = document.createElement('th');
    th.textContent = headingName(c + 1);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let r = 0; r < rows; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < columns; c++) {
      const td = document.createElement('td');
      td.appendChild(document.createElement('br'));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  frag.appendChild(table);

  const p = document.createElement('p');
  p.appendChild(document.createElement('br'));
  frag.appendChild(p);

  return frag;
}
