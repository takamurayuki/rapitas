'use client';
// TableSizePicker
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MAX_TABLE_ROWS, MAX_TABLE_COLUMNS, type TableShape } from '../table';

interface TableSizePickerProps {
  /** Insert a table of this shape. / この形で挿入する */
  onPick: (shape: TableShape) => void;
}

/**
 * A hoverable grid for choosing a table's shape before inserting it, the way
 * a spreadsheet does: moving over a square highlights the rectangle from the
 * top-left corner, and clicking inserts that shape.
 *
 * Keyboard and pointer reach the same cells — each square is a real button,
 * so focus moves through the grid and Enter picks, rather than hover being
 * the only way in.
 *
 * @param props - The insert callback / 挿入コールバック
 */
export function TableSizePicker({ onPick }: TableSizePickerProps) {
  const t = useTranslations('notes');
  // null while nothing is hovered or focused, so the label can stay quiet.
  const [hover, setHover] = useState<TableShape | null>(null);

  const rows = Array.from({ length: MAX_TABLE_ROWS }, (_, i) => i + 1);
  const columns = Array.from({ length: MAX_TABLE_COLUMNS }, (_, i) => i + 1);

  return (
    // The hover reset lives on the wrapper rather than the grid: a `grid`
    // role has to be focusable, and focus belongs on the cells. Clearing a
    // hover highlight needs no keyboard equivalent — focus already drives the
    // same selection.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="p-2" data-testid="table-size-picker" onMouseLeave={() => setHover(null)}>
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${MAX_TABLE_COLUMNS}, 1rem)` }}
        role="grid"
        aria-label={t('toolbar.insert.tableSizeGridLabel')}
      >
        {rows.map((r) =>
          columns.map((c) => {
            const selected = hover !== null && r <= hover.rows && c <= hover.columns;
            return (
              <button
                key={`${r}-${c}`}
                type="button"
                role="gridcell"
                aria-label={t('toolbar.insert.tableSizeCellLabel', { rows: r, columns: c })}
                aria-selected={selected}
                onMouseEnter={() => setHover({ rows: r, columns: c })}
                onFocus={() => setHover({ rows: r, columns: c })}
                onClick={() => onPick({ rows: r, columns: c })}
                className={`h-4 w-4 rounded-[2px] border transition-colors ${
                  selected
                    ? 'border-indigo-500 bg-indigo-400'
                    : 'border-zinc-300 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-700'
                }`}
              />
            );
          }),
        )}
      </div>
      <div
        className="mt-1.5 text-center text-xs text-zinc-600 dark:text-zinc-300"
        aria-live="polite"
      >
        {hover
          ? t('toolbar.insert.tableSizeLabel', { rows: hover.rows, columns: hover.columns })
          : t('toolbar.insert.tableSizeHint')}
      </div>
    </div>
  );
}
