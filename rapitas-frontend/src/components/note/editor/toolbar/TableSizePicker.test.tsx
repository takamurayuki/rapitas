/**
 * TableSizePicker.test
 *
 * The grid is the feature: hovering has to select the rectangle from the
 * top-left corner, and clicking has to insert exactly what was shown. The
 * keyboard path is covered too, because hover-only would leave the picker
 * unreachable without a pointer.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TableSizePicker } from './TableSizePicker';
import { MAX_TABLE_ROWS, MAX_TABLE_COLUMNS } from '../table';

// Mirrors the repo's toolbar tests: the key is the label, and an interpolated
// key renders with its values appended so a count can still be asserted.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

function renderPicker() {
  const onPick = vi.fn();
  render(<TableSizePicker onPick={onPick} />);
  return onPick;
}

/** The cell button for a 1-based row/column position. */
const cellAt = (rows: number, columns: number) =>
  screen.getByRole('gridcell', { name: `toolbar.insert.tableSizeCellLabel:${rows},${columns}` });

describe('TableSizePicker', () => {
  it('offers the full grid', () => {
    renderPicker();
    expect(screen.getAllByRole('gridcell')).toHaveLength(MAX_TABLE_ROWS * MAX_TABLE_COLUMNS);
  });

  it('shows a hint until something is hovered', () => {
    renderPicker();
    expect(screen.getByText('toolbar.insert.tableSizeHint')).toBeInTheDocument();
  });

  it('shows the dimensions of the hovered rectangle', () => {
    renderPicker();
    fireEvent.mouseEnter(cellAt(3, 4));
    expect(screen.getByText('toolbar.insert.tableSizeLabel:3,4')).toBeInTheDocument();
  });

  it('selects every cell from the top-left corner to the hovered one', () => {
    renderPicker();
    fireEvent.mouseEnter(cellAt(2, 3));
    expect(cellAt(1, 1)).toHaveAttribute('aria-selected', 'true');
    expect(cellAt(2, 3)).toHaveAttribute('aria-selected', 'true');
    // Outside the rectangle, in each direction.
    expect(cellAt(3, 3)).toHaveAttribute('aria-selected', 'false');
    expect(cellAt(2, 4)).toHaveAttribute('aria-selected', 'false');
  });

  it('picks exactly the hovered shape on click', () => {
    const onPick = renderPicker();
    fireEvent.click(cellAt(5, 2));
    expect(onPick).toHaveBeenCalledWith({ rows: 5, columns: 2 });
  });

  it('is reachable by keyboard — focus selects the same rectangle', () => {
    const onPick = renderPicker();
    fireEvent.focus(cellAt(2, 2));
    expect(cellAt(1, 1)).toHaveAttribute('aria-selected', 'true');
    expect(cellAt(2, 2)).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(cellAt(2, 2));
    expect(onPick).toHaveBeenCalledWith({ rows: 2, columns: 2 });
  });

  it('clears the selection when the pointer leaves the grid', () => {
    renderPicker();
    fireEvent.mouseEnter(cellAt(2, 2));
    fireEvent.mouseLeave(screen.getByTestId('table-size-picker'));
    expect(screen.getByText('toolbar.insert.tableSizeHint')).toBeInTheDocument();
  });
});
