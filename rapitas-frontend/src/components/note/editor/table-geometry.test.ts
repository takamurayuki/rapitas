/**
 * table-geometry.test
 *
 * jsdom reports every rect as zero, so these tests inject the reader and
 * assert the mapping — which cell each band comes from, and which rows count
 * as the heading — rather than real pixels. That mapping is where the
 * overlay goes wrong: a handle placed over the wrong column deletes the
 * wrong column.
 */
import { describe, it, expect } from 'vitest';
import {
  measureTable,
  orderedRows,
  deletionRemovesTable,
  hasSpannedCells,
  type RectOf,
} from './table-geometry';

/** Build a table with `cols` columns, a heading row and `bodyRows` body rows. */
function makeTable(cols: number, bodyRows: number): HTMLTableElement {
  const table = document.createElement('table');
  const thead = table.createTHead();
  const hr = thead.insertRow();
  for (let c = 0; c < cols; c++) hr.appendChild(document.createElement('th'));
  const tbody = table.createTBody();
  for (let r = 0; r < bodyRows; r++) {
    const tr = tbody.insertRow();
    for (let c = 0; c < cols; c++) tr.insertCell();
  }
  document.body.appendChild(table);
  return table;
}

/** A reader that makes each element's rect derivable from its position. */
function fakeRects(table: HTMLTableElement): RectOf {
  return (el) => {
    if (el === table) return { top: 0, left: 0, width: 300, height: 100 };
    if (el.tagName === 'TR') {
      const all = orderedRows(table).map((r) => r.row);
      const i = all.indexOf(el as HTMLTableRowElement);
      return { top: i * 20, left: 0, width: 300, height: 20 };
    }
    const cellIndex = (el as HTMLTableCellElement).cellIndex;
    return { top: 0, left: cellIndex * 100, width: 100, height: 20 };
  };
}

describe('orderedRows', () => {
  it('puts the heading row first and flags only it', () => {
    const t = makeTable(2, 2);
    const rows = orderedRows(t);
    expect(rows.map((r) => r.isHeader)).toEqual([true, false, false]);
  });

  it('returns nothing for a table with no rows', () => {
    expect(orderedRows(document.createElement('table'))).toEqual([]);
  });
});

describe('measureTable', () => {
  it('produces one band per column and per row', () => {
    const t = makeTable(3, 2);
    const g = measureTable(t, fakeRects(t))!;
    expect(g.columns).toHaveLength(3);
    expect(g.rows).toHaveLength(3); // heading + 2 body
  });

  it('places each column band at its own cell', () => {
    const t = makeTable(3, 1);
    const g = measureTable(t, fakeRects(t))!;
    expect(g.columns.map((c) => c.left)).toEqual([0, 100, 200]);
    expect(g.columns.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it('stacks row bands in visual order with the heading first', () => {
    const t = makeTable(2, 2);
    const g = measureTable(t, fakeRects(t))!;
    expect(g.rows.map((r) => r.top)).toEqual([0, 20, 40]);
    expect(g.rows.map((r) => r.isHeader)).toEqual([true, false, false]);
  });

  // A row mid-edit can be short. Measuring columns from the first row would
  // then drop handles for columns that genuinely exist.
  it('measures columns from the widest row, not the first', () => {
    const t = makeTable(2, 1);
    t.tBodies[0].rows[0].insertCell(); // body row now has 3, heading has 2
    const g = measureTable(t, fakeRects(t))!;
    expect(g.columns).toHaveLength(3);
  });

  it('returns null for a table with nothing to measure', () => {
    expect(
      measureTable(document.createElement('table'), () => ({
        top: 0,
        left: 0,
        width: 0,
        height: 0,
      })),
    ).toBeNull();
  });
});

describe('deletionRemovesTable', () => {
  it('is true when the last body row would go', () => {
    expect(deletionRemovesTable(makeTable(2, 1), 'row')).toBe(true);
    expect(deletionRemovesTable(makeTable(2, 2), 'row')).toBe(false);
  });

  it('is true when the last column would go', () => {
    expect(deletionRemovesTable(makeTable(1, 2), 'column')).toBe(true);
    expect(deletionRemovesTable(makeTable(2, 2), 'column')).toBe(false);
  });
});

/**
 * Tables that already exist in a note were not built by the inserter: they
 * come back through innerHTML, or were pasted from elsewhere. Measured
 * 2026-10-18 — a thead-less table works, two other shapes did not.
 */
describe('tables that were not created by the inserter', () => {
  const fromHtml = (html: string): HTMLTableElement => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    return host.querySelector('table') as HTMLTableElement;
  };
  const flat: RectOf = () => ({ top: 0, left: 0, width: 10, height: 10 });

  // The common pasted/legacy shape. The parser supplies the tbody.
  it('measures a table with no thead, and calls no row a heading', () => {
    const t = fromHtml('<table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>');
    const g = measureTable(t, flat)!;
    expect(g.columns).toHaveLength(2);
    expect(g.rows).toHaveLength(2);
    expect(g.rows.every((r) => !r.isHeader)).toBe(true);
  });

  it('measures every tbody, not only the first', () => {
    const t = fromHtml(
      '<table><tbody><tr><td>1</td></tr></tbody><tbody><tr><td>2</td></tr></tbody></table>',
    );
    expect(measureTable(t, flat)!.rows).toHaveLength(2);
  });

  it('counts rows across tbodies when deciding a deletion empties the table', () => {
    const t = fromHtml(
      '<table><tbody><tr><td>1</td></tr></tbody><tbody><tr><td>2</td></tr></tbody></table>',
    );
    expect(deletionRemovesTable(t, 'row')).toBe(false);
  });

  // cellIndex does not count spans, so an insert addressed by column index
  // can land elsewhere in a spanned row. Declining beats corrupting.
  it('offers no handles for a table with merged cells', () => {
    const t = fromHtml(
      '<table><thead><tr><th colspan="2">Wide</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    );
    expect(hasSpannedCells(t)).toBe(true);
    expect(measureTable(t, flat)).toBeNull();
  });

  it('still offers handles when nothing is merged', () => {
    const t = fromHtml('<table><tr><td>1</td><td>2</td></tr></table>');
    expect(hasSpannedCells(t)).toBe(false);
    expect(measureTable(t, flat)).not.toBeNull();
  });
});
