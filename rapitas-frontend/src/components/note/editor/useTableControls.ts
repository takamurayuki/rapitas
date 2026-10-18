'use client';
/**
 * useTableControls
 *
 * Tracks which table the user is working in and where its columns and rows
 * are, so handles can be drawn over them. Owns no DOM surgery — it resolves
 * the target and hands it to `table-ops`.
 *
 * The table is followed by pointer as well as caret: Confluence shows the
 * handles when you move onto a table, and requiring a click into a cell
 * first is most of what made the toolbar version feel absent.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { measureTable, type TableGeometry } from './table-geometry';
import {
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  type ColumnSide,
  type HeadingNamer,
  type RowSide,
} from './table-ops';

/** Which handle is open, and therefore which band is highlighted. */
export interface ActiveHandle {
  axis: 'row' | 'column';
  /** 0-based index within the measured bands. / 対象の番号 */
  index: number;
}

/** What the overlay needs to render and act. */
export interface UseTableControlsReturn {
  /** The tracked table, or null when the pointer and caret are both away. */
  table: HTMLTableElement | null;
  geometry: TableGeometry | null;
  active: ActiveHandle | null;
  setActive: (handle: ActiveHandle | null) => void;
  /** Re-measure after a layout change. / 再計測 */
  remeasure: () => void;
  insertAtRow: (index: number, side: RowSide) => void;
  insertAtColumn: (index: number, side: ColumnSide) => void;
  removeRow: (index: number) => void;
  removeColumn: (index: number) => void;
}

/** The row element for a measured row index (heading row is index 0). */
function rowAt(table: HTMLTableElement, index: number): HTMLTableRowElement | null {
  const head = Array.from(table.tHead?.rows ?? []);
  const body = Array.from(table.tBodies[0]?.rows ?? []);
  return [...head, ...body][index] ?? null;
}

/** Any cell in a measured column, preferring a body cell so ops see tbody. */
function cellInColumn(table: HTMLTableElement, index: number): HTMLTableCellElement | null {
  const body = table.tBodies[0]?.rows;
  for (const row of Array.from(body ?? [])) {
    const cell = row.cells[index];
    if (cell) return cell;
  }
  return (table.tHead?.rows[0]?.cells[index] as HTMLTableCellElement | undefined) ?? null;
}

/**
 * Track the table under the caret or pointer and expose its edit operations.
 *
 * @param contentRef - The editor's contentEditable root / エディタ本体
 * @param headingName - Names a heading by 1-based position / 見出しの命名
 * @param onChange - Called after any edit, to persist / 変更後の保存通知
 * @returns The tracked table, its geometry and the operations / 追跡結果と操作
 */
export function useTableControls(
  contentRef: React.RefObject<HTMLDivElement | null>,
  headingName: HeadingNamer,
  onChange: () => void,
): UseTableControlsReturn {
  const [table, setTable] = useState<HTMLTableElement | null>(null);
  const [geometry, setGeometry] = useState<TableGeometry | null>(null);
  const [active, setActive] = useState<ActiveHandle | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  tableRef.current = table;

  const remeasure = useCallback(() => {
    const current = tableRef.current;
    if (!current || !current.isConnected) {
      setTable(null);
      setGeometry(null);
      setActive(null);
      return;
    }
    setGeometry(measureTable(current));
  }, []);

  /** Adopt a table, or drop the current one. */
  const focusTable = useCallback((next: HTMLTableElement | null) => {
    setTable((prev) => {
      if (prev === next) return prev;
      // A different table means the open menu belonged to the old one.
      setActive(null);
      setGeometry(next ? measureTable(next) : null);
      return next;
    });
  }, []);

  // Follow the pointer and the caret. Both are registered on the editor root
  // so a table outside it can never be adopted.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    const tableFrom = (node: EventTarget | Node | null): HTMLTableElement | null => {
      if (!(node instanceof Node)) return null;
      const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      const found = el?.closest('table') ?? null;
      return found && root.contains(found) ? (found as HTMLTableElement) : null;
    };

    const onPointerMove = (e: PointerEvent) => {
      const next = tableFrom(e.target);
      // Leaving a table keeps its handles while a menu is open, so the menu
      // does not vanish on the way to clicking it.
      if (!next && active) return;
      focusTable(next);
    };

    const onSelectionChange = () => {
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const node = sel.getRangeAt(0).startContainer;
      if (!root.contains(node)) return;
      const next = tableFrom(node);
      if (next) focusTable(next);
    };

    root.addEventListener('pointermove', onPointerMove);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      root.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [contentRef, focusTable, active]);

  // Keep the handles on the table while the editor scrolls or the window
  // resizes. Capture catches the editor's own scroll container too.
  useEffect(() => {
    if (!table) return;
    window.addEventListener('scroll', remeasure, true);
    window.addEventListener('resize', remeasure);
    return () => {
      window.removeEventListener('scroll', remeasure, true);
      window.removeEventListener('resize', remeasure);
    };
  }, [table, remeasure]);

  /** Run an op against the tracked table, then persist and re-measure. */
  const operate = useCallback(
    (run: (t: HTMLTableElement) => void) => {
      const current = tableRef.current;
      if (!current) return;
      run(current);
      onChange();
      setActive(null);
      // The table may have been removed entirely (last row/column).
      if (!current.isConnected) {
        setTable(null);
        setGeometry(null);
        return;
      }
      setGeometry(measureTable(current));
    },
    [onChange],
  );

  const insertAtRow = useCallback(
    (index: number, side: RowSide) =>
      operate((t) => {
        const row = rowAt(t, index);
        const cell = row?.cells[0];
        if (cell) insertRow(cell as HTMLTableCellElement, side);
      }),
    [operate],
  );

  const insertAtColumn = useCallback(
    (index: number, side: ColumnSide) =>
      operate((t) => {
        const cell = cellInColumn(t, index);
        if (cell) insertColumn(cell, side, headingName);
      }),
    [operate, headingName],
  );

  const removeRow = useCallback(
    (index: number) =>
      operate((t) => {
        const row = rowAt(t, index);
        const cell = row?.cells[0];
        if (cell) deleteRow(cell as HTMLTableCellElement);
      }),
    [operate],
  );

  const removeColumn = useCallback(
    (index: number) =>
      operate((t) => {
        const cell = cellInColumn(t, index);
        if (cell) deleteColumn(cell);
      }),
    [operate],
  );

  return {
    table,
    geometry,
    active,
    setActive,
    remeasure,
    insertAtRow,
    insertAtColumn,
    removeRow,
    removeColumn,
  };
}
