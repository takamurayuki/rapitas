'use client';
/**
 * TableControlsOverlay
 *
 * Confluence-style handles over the table being edited: a bar above each
 * column and beside each row, clicked to insert or delete that column or
 * row. Draws only — `useTableControls` decides what is tracked and
 * `table-ops` does the surgery.
 *
 * Fixed positioning on purpose. The handles must sit over a table inside a
 * scrolling contentEditable, and nothing may be added to the table itself:
 * the editor's innerHTML is the saved note, so an injected element would be
 * persisted into the document.
 */
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Trash2 } from 'lucide-react';
import type { ActiveHandle, UseTableControlsReturn } from './useTableControls';
import { deletionRemovesTable } from './table-geometry';

/** Thickness of a handle bar, and the gap it sits off the table. */
const HANDLE = 14;
const GAP = 2;

interface TableControlsOverlayProps {
  controls: UseTableControlsReturn;
}

/** One action in the handle's menu. */
interface MenuAction {
  key: string;
  label: string;
  icon: typeof ArrowUp;
  run: () => void;
  danger?: boolean;
}

/**
 * Handles and the open handle's menu, or nothing when no table is tracked.
 *
 * @param props - The tracking state and operations / 追跡状態と操作
 */
export function TableControlsOverlay({ controls }: TableControlsOverlayProps) {
  const t = useTranslations('notes.tableControls');
  const { table, geometry, active, setActive } = controls;
  if (!table || !geometry) return null;

  const openMenu = (handle: ActiveHandle) =>
    setActive(
      active && active.axis === handle.axis && active.index === handle.index ? null : handle,
    );

  const actionsFor = (handle: ActiveHandle): MenuAction[] => {
    if (handle.axis === 'column') {
      const lastOne = deletionRemovesTable(table, 'column');
      return [
        {
          key: 'left',
          label: t('insertColumnLeft'),
          icon: ArrowLeft,
          run: () => controls.insertAtColumn(handle.index, 'left'),
        },
        {
          key: 'right',
          label: t('insertColumnRight'),
          icon: ArrowRight,
          run: () => controls.insertAtColumn(handle.index, 'right'),
        },
        {
          key: 'delete',
          // Deleting the only column removes the table; say so rather than
          // letting the document silently lose it.
          label: lastOne ? t('deleteTableWithLastColumn') : t('deleteColumn'),
          icon: Trash2,
          run: () => controls.removeColumn(handle.index),
          danger: true,
        },
      ];
    }
    const lastOne = deletionRemovesTable(table, 'row');
    return [
      {
        key: 'above',
        label: t('insertRowAbove'),
        icon: ArrowUp,
        run: () => controls.insertAtRow(handle.index, 'above'),
      },
      {
        key: 'below',
        label: t('insertRowBelow'),
        icon: ArrowDown,
        run: () => controls.insertAtRow(handle.index, 'below'),
      },
      {
        key: 'delete',
        label: lastOne ? t('deleteTableWithLastRow') : t('deleteRow'),
        icon: Trash2,
        run: () => controls.removeRow(handle.index),
        danger: true,
      },
    ];
  };

  const isActive = (axis: 'row' | 'column', index: number) =>
    active?.axis === axis && active.index === index;

  const handleClass = (on: boolean) =>
    `fixed z-40 rounded-sm border transition-colors ${
      on
        ? 'border-indigo-500 bg-indigo-400'
        : 'border-zinc-300 bg-zinc-200 hover:bg-indigo-300 dark:border-zinc-600 dark:bg-zinc-700'
    }`;

  // Anchor the menu to the handle that opened it.
  const menuPosition = (): { top: number; left: number } | null => {
    if (!active) return null;
    if (active.axis === 'column') {
      const band = geometry.columns[active.index];
      if (!band) return null;
      return { top: geometry.rect.top - HANDLE - GAP, left: band.left };
    }
    const band = geometry.rows[active.index];
    if (!band) return null;
    return { top: band.top, left: geometry.rect.left - HANDLE - GAP };
  };

  const menuAt = menuPosition();

  return (
    <>
      {geometry.columns.map((band) => (
        <button
          key={`col-${band.index}`}
          type="button"
          aria-label={t('columnHandle', { index: band.index + 1 })}
          // mousedown would move the caret out of the cell before the click
          // lands, and the ops resolve their target from the table, not the
          // selection — but the editor would still scroll to the new caret.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => openMenu({ axis: 'column', index: band.index })}
          className={handleClass(isActive('column', band.index))}
          style={{
            top: geometry.rect.top - HANDLE - GAP,
            left: band.left,
            width: Math.max(band.width - 1, 4),
            height: HANDLE,
          }}
        />
      ))}

      {geometry.rows.map((band) => (
        <button
          key={`row-${band.index}`}
          type="button"
          aria-label={t('rowHandle', { index: band.index + 1 })}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => openMenu({ axis: 'row', index: band.index })}
          className={handleClass(isActive('row', band.index))}
          style={{
            top: band.top,
            left: geometry.rect.left - HANDLE - GAP,
            width: HANDLE,
            height: Math.max(band.height - 1, 4),
          }}
        />
      ))}

      {active && menuAt && (
        <div
          role="menu"
          aria-label={t('menuLabel')}
          // Focusable but not a tab stop: an ARIA menu owns focus for its
          // items, and putting the container itself in the tab order would
          // add a stop that does nothing.
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          className="fixed z-50 min-w-44 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
          style={{ top: menuAt.top + HANDLE + GAP, left: menuAt.left }}
        >
          {actionsFor(active).map(({ key, label, icon: Icon, run, danger }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              onClick={run}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                danger
                  ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30'
                  : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="whitespace-nowrap">{label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
