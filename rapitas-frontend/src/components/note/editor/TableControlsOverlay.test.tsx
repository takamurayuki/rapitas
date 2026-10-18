/**
 * TableControlsOverlay.test
 *
 * The handle has to act on the band it sits over — a handle that deletes the
 * neighbouring column is worse than no handle at all, and nothing about the
 * rendering says which index it carries. These tests pin the handle→index→
 * operation path, and the warning shown when a deletion would take the whole
 * table with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TableControlsOverlay } from './TableControlsOverlay';
import type { UseTableControlsReturn } from './useTableControls';
import type { TableGeometry } from './table-geometry';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

/** A 2-column, heading + 2 body row table. */
function makeTable(cols = 2, bodyRows = 2): HTMLTableElement {
  const table = document.createElement('table');
  const hr = table.createTHead().insertRow();
  for (let c = 0; c < cols; c++) hr.appendChild(document.createElement('th'));
  const tbody = table.createTBody();
  for (let r = 0; r < bodyRows; r++) {
    const tr = tbody.insertRow();
    for (let c = 0; c < cols; c++) tr.insertCell();
  }
  document.body.appendChild(table);
  return table;
}

function geometryFor(cols: number, rows: number): TableGeometry {
  return {
    rect: { top: 100, left: 50, width: 300, height: 90 },
    columns: Array.from({ length: cols }, (_, index) => ({
      index,
      left: 50 + index * 100,
      width: 100,
    })),
    rows: Array.from({ length: rows }, (_, index) => ({
      index,
      top: 100 + index * 30,
      height: 30,
      isHeader: index === 0,
    })),
  };
}

function setup(table = makeTable(), cols = 2, rows = 3) {
  const controls: UseTableControlsReturn = {
    table,
    geometry: geometryFor(cols, rows),
    active: null,
    setActive: vi.fn(),
    remeasure: vi.fn(),
    insertAtRow: vi.fn(),
    insertAtColumn: vi.fn(),
    removeRow: vi.fn(),
    removeColumn: vi.fn(),
  };
  const view = render(<TableControlsOverlay controls={controls} />);
  return { controls, view };
}

describe('TableControlsOverlay', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders nothing without a tracked table', () => {
    const controls = { ...setup().controls, table: null, geometry: null };
    const { container } = render(<TableControlsOverlay controls={controls} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers one handle per column and per row', () => {
    setup(makeTable(2, 2), 2, 3);
    expect(screen.getAllByLabelText(/columnHandle:/)).toHaveLength(2);
    expect(screen.getAllByLabelText(/rowHandle:/)).toHaveLength(3);
  });

  it('opens the menu for the handle that was clicked', () => {
    const { controls } = setup();
    fireEvent.click(screen.getByLabelText('columnHandle:2'));
    expect(controls.setActive).toHaveBeenCalledWith({ axis: 'column', index: 1 });
  });

  it('closes the menu when the open handle is clicked again', () => {
    const table = makeTable();
    const controls: UseTableControlsReturn = {
      ...setup(table).controls,
      active: { axis: 'column', index: 1 },
      setActive: vi.fn(),
    };
    render(<TableControlsOverlay controls={controls} />);
    fireEvent.click(screen.getAllByLabelText('columnHandle:2')[1]);
    expect(controls.setActive).toHaveBeenCalledWith(null);
  });

  it('acts on the column its handle sits over', () => {
    const table = makeTable();
    const controls: UseTableControlsReturn = {
      ...setup(table).controls,
      active: { axis: 'column', index: 1 },
    };
    render(<TableControlsOverlay controls={controls} />);
    fireEvent.click(screen.getByText('insertColumnRight'));
    expect(controls.insertAtColumn).toHaveBeenCalledWith(1, 'right');
  });

  it('acts on the row its handle sits over', () => {
    const table = makeTable();
    const controls: UseTableControlsReturn = {
      ...setup(table).controls,
      active: { axis: 'row', index: 2 },
    };
    render(<TableControlsOverlay controls={controls} />);
    fireEvent.click(screen.getByText('insertRowAbove'));
    expect(controls.insertAtRow).toHaveBeenCalledWith(2, 'above');
    fireEvent.click(screen.getByText('deleteRow'));
    expect(controls.removeRow).toHaveBeenCalledWith(2);
  });

  // table-ops removes the whole table when the last row or column goes. That
  // is correct, and silently losing the table is not what "delete row" reads
  // as, so the label says it before the click.
  it('warns when deleting the row would remove the table', () => {
    const table = makeTable(2, 1);
    const controls: UseTableControlsReturn = {
      ...setup(table, 2, 2).controls,
      table,
      active: { axis: 'row', index: 1 },
    };
    render(<TableControlsOverlay controls={controls} />);
    expect(screen.getByText('deleteTableWithLastRow')).toBeInTheDocument();
  });

  it('warns when deleting the column would remove the table', () => {
    const table = makeTable(1, 2);
    const controls: UseTableControlsReturn = {
      ...setup(table, 1, 3).controls,
      table,
      active: { axis: 'column', index: 0 },
    };
    render(<TableControlsOverlay controls={controls} />);
    expect(screen.getByText('deleteTableWithLastColumn')).toBeInTheDocument();
  });
});
