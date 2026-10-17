/**
 * table-ops tests
 *
 * Row and column surgery on a table already in the document. The cases that
 * matter are the destructive ones: deleting the last row or column must not
 * leave an empty `<table>` behind, and an operation must never act on a table
 * the caret is not in.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  findTableCell,
  insertRow,
  insertColumn,
  deleteRow,
  deleteColumn,
  deleteTable,
} from './table-ops';

/** A table with `rows` body rows and `cols` columns, plus a heading row. */
function build(rows: number, cols: number): HTMLTableElement {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (let c = 0; c < cols; c++) {
    const th = document.createElement('th');
    th.textContent = `列${c + 1}`;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (let r = 0; r < rows; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < cols; c++) {
      const td = document.createElement('td');
      td.textContent = `r${r}c${c}`;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

/** Body cell at (row, col). */
function cell(table: HTMLTableElement, row: number, col: number): HTMLTableCellElement {
  return table.tBodies[0].rows[row].cells[col];
}

/** Body contents as a grid, for comparing shape and order in one assertion. */
function grid(table: HTMLTableElement): string[][] {
  return Array.from(table.tBodies[0].rows).map((tr) =>
    Array.from(tr.cells).map((td) => td.textContent ?? ''),
  );
}

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.innerHTML = '';
  document.body.appendChild(host);
});

describe('findTableCell', () => {
  it('finds the cell from a node inside it', () => {
    const table = build(2, 3);
    host.appendChild(table);
    const target = cell(table, 1, 2);
    expect(findTableCell(target.firstChild, host)).toBe(target);
  });

  it('returns null for a node outside any table', () => {
    const p = document.createElement('p');
    p.textContent = 'plain';
    host.appendChild(p);
    expect(findTableCell(p.firstChild, host)).toBeNull();
  });

  it('refuses a table outside the editor root, so the toolbar cannot reach elsewhere', () => {
    const outside = build(2, 2);
    document.body.appendChild(outside);
    expect(findTableCell(cell(outside, 0, 0), host)).toBeNull();
  });
});

describe('insertRow', () => {
  it('inserts above the caret row', () => {
    const table = build(2, 2);
    host.appendChild(table);
    insertRow(cell(table, 1, 0), 'above');
    expect(grid(table)).toEqual([
      ['r0c0', 'r0c1'],
      ['', ''],
      ['r1c0', 'r1c1'],
    ]);
  });

  it('inserts below the caret row', () => {
    const table = build(2, 2);
    host.appendChild(table);
    insertRow(cell(table, 0, 0), 'below');
    expect(grid(table)).toEqual([
      ['r0c0', 'r0c1'],
      ['', ''],
      ['r1c0', 'r1c1'],
    ]);
  });

  it('gives the new row one cell per column', () => {
    const table = build(1, 4);
    host.appendChild(table);
    insertRow(cell(table, 0, 0), 'below');
    expect(table.tBodies[0].rows[1].cells).toHaveLength(4);
  });
});

describe('insertColumn', () => {
  it('inserts to the left of the caret column, in the body and the heading', () => {
    const table = build(1, 2);
    host.appendChild(table);
    insertColumn(cell(table, 0, 1), 'left', (n) => `列${n}`);
    expect(grid(table)).toEqual([['r0c0', '', 'r0c1']]);
    expect(table.tHead?.rows[0].cells).toHaveLength(3);
  });

  it('inserts to the right of the caret column', () => {
    const table = build(1, 2);
    host.appendChild(table);
    insertColumn(cell(table, 0, 0), 'right', (n) => `列${n}`);
    expect(grid(table)).toEqual([['r0c0', '', 'r0c1']]);
  });

  it('names the new heading by its position, so numbering stays consistent', () => {
    const table = build(1, 2);
    host.appendChild(table);
    insertColumn(cell(table, 0, 1), 'right', (n) => `列${n}`);
    expect(Array.from(table.tHead!.rows[0].cells).map((th) => th.textContent)).toEqual([
      '列1',
      '列2',
      '列3',
    ]);
  });
});

describe('deleteRow', () => {
  it('removes the caret row only', () => {
    const table = build(3, 2);
    host.appendChild(table);
    deleteRow(cell(table, 1, 0));
    expect(grid(table)).toEqual([
      ['r0c0', 'r0c1'],
      ['r2c0', 'r2c1'],
    ]);
  });

  it('removes the whole table when the last body row goes', () => {
    // A heading row with no body is not a table anyone wants left behind.
    const table = build(1, 2);
    host.appendChild(table);
    deleteRow(cell(table, 0, 0));
    expect(host.querySelector('table')).toBeNull();
  });
});

describe('deleteColumn', () => {
  it('removes the caret column from every row including the heading', () => {
    const table = build(2, 3);
    host.appendChild(table);
    deleteColumn(cell(table, 0, 1));
    expect(grid(table)).toEqual([
      ['r0c0', 'r0c2'],
      ['r1c0', 'r1c2'],
    ]);
    expect(table.tHead?.rows[0].cells).toHaveLength(2);
  });

  it('removes the whole table when the last column goes', () => {
    const table = build(2, 1);
    host.appendChild(table);
    deleteColumn(cell(table, 0, 0));
    expect(host.querySelector('table')).toBeNull();
  });
});

describe('deleteTable', () => {
  it('removes the table the cell belongs to', () => {
    const table = build(2, 2);
    host.appendChild(table);
    deleteTable(cell(table, 0, 0));
    expect(host.querySelector('table')).toBeNull();
  });
});
