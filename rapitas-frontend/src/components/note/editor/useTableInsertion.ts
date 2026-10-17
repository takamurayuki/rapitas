'use client';
/**
 * useTableInsertion
 *
 * Everything the toolbar needs to put a table into the editor and reshape one
 * that is already there. It owns no state — the caret is the only thing it
 * reads, and `table-ops` does the DOM surgery.
 */
import { useCallback } from 'react';
import { isInTitleInput } from './formatting';
import { createTableNode, type TableShape } from './table';
import {
  findTableCell,
  insertRow,
  insertColumn,
  deleteRow,
  deleteColumn,
  deleteTable,
  type ColumnSide,
  type HeadingNamer,
  type RowSide,
} from './table-ops';

/** The table handlers the toolbar binds to. */
export interface TableInsertionHandlers {
  insertTable: (shape: TableShape) => void;
  /** Whether the caret currently sits inside a table. / カーソルが表内にあるか */
  isCaretInTable: () => boolean;
  insertTableRow: (side: RowSide) => void;
  insertTableColumn: (side: ColumnSide) => void;
  deleteTableRow: () => void;
  deleteTableColumn: () => void;
  deleteCurrentTable: () => void;
}

/**
 * Table insertion and row/column editing bound to the caret.
 *
 * @param contentRef - The editor's contentEditable element / エディタ本体
 * @param handleContentChange - Marks the note dirty after a change / 変更の通知
 * @param headingName - Names a heading by 1-based column position / 見出しの命名
 * @returns The table handlers / テーブル操作ハンドラ
 */
export function useTableInsertion(
  contentRef: React.RefObject<HTMLDivElement | null>,
  handleContentChange: () => void,
  headingName: HeadingNamer,
): TableInsertionHandlers {
  const insertTable = useCallback(
    (shape: TableShape) => {
      if (isInTitleInput()) return;
      if (!contentRef.current?.contains(document.activeElement)) {
        contentRef.current?.focus();
      }
      const frag = createTableNode(shape, headingName);
      const lastChild = frag.lastChild;
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (!contentRef.current?.contains(range.commonAncestorContainer)) return;
        range.deleteContents();
        range.insertNode(frag);
        if (lastChild) {
          const newRange = document.createRange();
          newRange.setStartAfter(lastChild);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      } else if (contentRef.current) {
        contentRef.current.appendChild(frag);
      }
      handleContentChange();
    },
    [contentRef, handleContentChange, headingName],
  );

  /**
   * The table cell the caret is in, if any.
   *
   * Scoped to the editor root so a toolbar action can never reach a table
   * elsewhere on the page when the editor holds no selection of its own.
   */
  const caretCell = useCallback(() => {
    const selection = window.getSelection();
    const node =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0).startContainer : null;
    return findTableCell(node, contentRef.current);
  }, [contentRef]);

  const isCaretInTable = useCallback(() => caretCell() !== null, [caretCell]);

  /** Run a table operation on the caret's cell, then persist. */
  const onCaretCell = useCallback(
    (run: (cell: HTMLTableCellElement) => void) => {
      const cell = caretCell();
      if (!cell) return;
      run(cell);
      handleContentChange();
    },
    [caretCell, handleContentChange],
  );

  const insertTableRow = useCallback(
    (side: RowSide) => onCaretCell((cell) => insertRow(cell, side)),
    [onCaretCell],
  );

  const insertTableColumn = useCallback(
    (side: ColumnSide) => onCaretCell((cell) => insertColumn(cell, side, headingName)),
    [onCaretCell, headingName],
  );

  const deleteTableRow = useCallback(() => onCaretCell(deleteRow), [onCaretCell]);
  const deleteTableColumn = useCallback(() => onCaretCell(deleteColumn), [onCaretCell]);
  const deleteCurrentTable = useCallback(() => onCaretCell(deleteTable), [onCaretCell]);

  return {
    insertTable,
    isCaretInTable,
    insertTableRow,
    insertTableColumn,
    deleteTableRow,
    deleteTableColumn,
    deleteCurrentTable,
  };
}
