'use client';
/**
 * useTableControls
 *
 * Tracks which table the user is working in and where its columns and rows
 * are, so handles can be drawn over them. Owns no DOM surgery — it resolves
 * the target and hands it to `table-ops`.
 *
 * Two things here exist because of how the handles are reached, and both
 * were found by using it (#1062):
 *
 * - The table is NOT dropped the moment the pointer leaves it. The handles
 *   sit outside the table, so every path to one crosses a gap that is not
 *   the table — dropping immediately made them flash and vanish before they
 *   could be clicked, which is exactly how this was reported.
 * - The overlay can hold the table open while the pointer is on it, because
 *   the handles are rendered outside the contentEditable and the editor's
 *   own pointer events never see them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { measureTable, toContainerSpace, type TableGeometry } from './table-geometry';
import {
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  type ColumnSide,
  type HeadingNamer,
  type RowSide,
} from './table-ops';

/**
 * How long the handles stay after the pointer leaves the table.
 *
 * Long enough to cross the gap between the table and a handle without
 * hurrying, short enough that they are gone by the time attention has moved
 * on. They also stay while the pointer is actually on them, so this only
 * covers the crossing.
 */
const LINGER_MS = 400;

/** Which handle is open, and therefore which band is highlighted. */
export interface ActiveHandle {
  axis: 'row' | 'column';
  /** 0-based index within the measured bands. / 対象の番号 */
  index: number;
}

/** What the overlay needs to render and act. */
export interface UseTableControlsReturn {
  /** The tracked table, or null when nothing is being hovered or edited. */
  table: HTMLTableElement | null;
  /** Bands in the scroll container's coordinate space. / コンテナ基準のバンド */
  geometry: TableGeometry | null;
  active: ActiveHandle | null;
  setActive: (handle: ActiveHandle | null) => void;
  /** Keep the handles while the pointer is on them. / ハンドル上で保持 */
  hold: () => void;
  /** Release the hold and start the linger countdown. / 保持を解除 */
  release: () => void;
  insertAtRow: (index: number, side: RowSide) => void;
  insertAtColumn: (index: number, side: ColumnSide) => void;
  removeRow: (index: number) => void;
  removeColumn: (index: number) => void;
}

/** The row element for a measured row index (heading rows come first). */
function rowAt(table: HTMLTableElement, index: number): HTMLTableRowElement | null {
  const head = Array.from(table.tHead?.rows ?? []);
  const body = Array.from(table.tBodies).flatMap((s) => Array.from(s.rows));
  return [...head, ...body][index] ?? null;
}

/** Any cell in a measured column, preferring a body cell so ops see tbody. */
function cellInColumn(table: HTMLTableElement, index: number): HTMLTableCellElement | null {
  for (const section of Array.from(table.tBodies)) {
    for (const row of Array.from(section.rows)) {
      const cell = row.cells[index];
      if (cell) return cell;
    }
  }
  return (table.tHead?.rows[0]?.cells[index] as HTMLTableCellElement | undefined) ?? null;
}

/**
 * Track the table under the caret or pointer and expose its edit operations.
 *
 * @param contentRef - The editor's contentEditable root / エディタ本体
 * @param containerRef - The scrolling box the handles are drawn in / 配置基準
 * @param headingName - Names a heading by 1-based position / 見出しの命名
 * @param onChange - Called after any edit, to persist / 変更後の保存通知
 * @returns The tracked table, its geometry and the operations / 追跡結果と操作
 */
export function useTableControls(
  contentRef: React.RefObject<HTMLDivElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  headingName: HeadingNamer,
  onChange: () => void,
): UseTableControlsReturn {
  const [table, setTable] = useState<HTMLTableElement | null>(null);
  const [geometry, setGeometry] = useState<TableGeometry | null>(null);
  const [active, setActive] = useState<ActiveHandle | null>(null);

  const tableRef = useRef<HTMLTableElement | null>(null);
  tableRef.current = table;
  const activeRef = useRef<ActiveHandle | null>(null);
  activeRef.current = active;
  const heldRef = useRef(false);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Measure in container space, so absolute positioning lines up. */
  const measure = useCallback(
    (target: HTMLTableElement): TableGeometry | null => {
      const viewport = measureTable(target);
      const box = containerRef.current;
      if (!viewport || !box) return viewport;
      const rect = box.getBoundingClientRect();
      return toContainerSpace(viewport, {
        rect: { top: rect.top, left: rect.left },
        scrollTop: box.scrollTop,
        scrollLeft: box.scrollLeft,
      });
    },
    [containerRef],
  );

  const cancelLinger = useCallback(() => {
    if (lingerTimer.current) {
      clearTimeout(lingerTimer.current);
      lingerTimer.current = null;
    }
  }, []);

  const drop = useCallback(() => {
    setTable(null);
    setGeometry(null);
    setActive(null);
  }, []);

  /** Leave the handles up for a moment; the pointer may be on its way to one. */
  const scheduleDrop = useCallback(() => {
    if (lingerTimer.current) return;
    lingerTimer.current = setTimeout(() => {
      lingerTimer.current = null;
      // An open menu or a pointer resting on the handles both mean "still in
      // use" — only a genuine departure drops the table.
      if (heldRef.current || activeRef.current) return;
      drop();
    }, LINGER_MS);
  }, [drop]);

  const focusTable = useCallback(
    (next: HTMLTableElement) => {
      cancelLinger();
      setTable((prev) => {
        if (prev === next) return prev;
        setActive(null);
        return next;
      });
      setGeometry(measure(next));
    },
    [cancelLinger, measure],
  );

  const hold = useCallback(() => {
    heldRef.current = true;
    cancelLinger();
  }, [cancelLinger]);

  const release = useCallback(() => {
    heldRef.current = false;
    scheduleDrop();
  }, [scheduleDrop]);

  const remeasure = useCallback(() => {
    const current = tableRef.current;
    if (!current) return;
    if (!current.isConnected) {
      drop();
      return;
    }
    setGeometry(measure(current));
  }, [drop, measure]);

  // Follow the pointer and the caret, both scoped to the editor so a table
  // elsewhere on the page can never be adopted.
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
      if (next) focusTable(next);
      else scheduleDrop();
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
  }, [contentRef, focusTable, scheduleDrop]);

  // Keep the handles on the table while the editor scrolls or resizes.
  useEffect(() => {
    if (!table) return;
    const box = containerRef.current;
    box?.addEventListener('scroll', remeasure);
    window.addEventListener('resize', remeasure);
    return () => {
      box?.removeEventListener('scroll', remeasure);
      window.removeEventListener('resize', remeasure);
    };
  }, [table, containerRef, remeasure]);

  useEffect(() => cancelLinger, [cancelLinger]);

  /** Run an op against the tracked table, then persist and re-measure. */
  const operate = useCallback(
    (run: (t: HTMLTableElement) => void) => {
      const current = tableRef.current;
      if (!current) return;
      run(current);
      onChange();
      setActive(null);
      if (!current.isConnected) {
        drop();
        return;
      }
      setGeometry(measure(current));
    },
    [onChange, drop, measure],
  );

  const insertAtRow = useCallback(
    (index: number, side: RowSide) =>
      operate((t) => {
        const cell = rowAt(t, index)?.cells[0];
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
        const cell = rowAt(t, index)?.cells[0];
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
    hold,
    release,
    insertAtRow,
    insertAtColumn,
    removeRow,
    removeColumn,
  };
}
