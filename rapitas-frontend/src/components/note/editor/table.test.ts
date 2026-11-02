/**
 * table tests
 *
 * `createTableNode` used to be hard-wired to three columns and two rows. It
 * now takes a shape, so the cases worth pinning are the boundaries of that
 * shape and the trailing paragraph that lets the cursor escape.
 */
import { describe, it, expect } from 'vitest';
import { createTableNode, MAX_TABLE_ROWS, MAX_TABLE_COLUMNS } from './table';

const name = (n: number) => `列${n}`;

/** The table inside the fragment. */
function tableOf(frag: DocumentFragment): HTMLTableElement {
  const table = frag.querySelector('table');
  if (!table) throw new Error('no table in fragment');
  return table;
}

describe('createTableNode', () => {
  it('builds exactly the requested shape', () => {
    const table = tableOf(createTableNode({ rows: 4, columns: 5 }, name));
    expect(table.tHead?.rows[0].cells).toHaveLength(5);
    expect(table.tBodies[0].rows).toHaveLength(4);
    expect(table.tBodies[0].rows[0].cells).toHaveLength(5);
  });

  it('numbers the headings by position', () => {
    const table = tableOf(createTableNode({ rows: 1, columns: 3 }, name));
    expect(Array.from(table.tHead!.rows[0].cells).map((th) => th.textContent)).toEqual([
      '列1',
      '列2',
      '列3',
    ]);
  });

  it('leaves body cells empty but focusable', () => {
    const table = tableOf(createTableNode({ rows: 1, columns: 2 }, name));
    for (const td of Array.from(table.tBodies[0].rows[0].cells)) {
      expect(td.textContent).toBe('');
      expect(td.querySelector('br')).not.toBeNull();
    }
  });

  it('appends a paragraph after the table so the cursor can escape', () => {
    const frag = createTableNode({ rows: 1, columns: 1 }, name);
    expect(frag.lastChild?.nodeName).toBe('P');
  });

  it('clamps a shape below one up to one', () => {
    const table = tableOf(createTableNode({ rows: 0, columns: 0 }, name));
    expect(table.tBodies[0].rows).toHaveLength(1);
    expect(table.tHead?.rows[0].cells).toHaveLength(1);
  });

  it('clamps a shape above the maximum', () => {
    const table = tableOf(
      createTableNode({ rows: MAX_TABLE_ROWS + 5, columns: MAX_TABLE_COLUMNS + 5 }, name),
    );
    expect(table.tBodies[0].rows).toHaveLength(MAX_TABLE_ROWS);
    expect(table.tHead?.rows[0].cells).toHaveLength(MAX_TABLE_COLUMNS);
  });

  it('offers at least an 8x8 grid', () => {
    expect(MAX_TABLE_ROWS).toBeGreaterThanOrEqual(8);
    expect(MAX_TABLE_COLUMNS).toBeGreaterThanOrEqual(8);
  });
});
