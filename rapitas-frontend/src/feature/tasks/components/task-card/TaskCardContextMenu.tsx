/**
 * TaskCardContextMenu
 *
 * Fixed-position context menu shown on right-click of a TaskCard.
 * Stateless — position and visibility are controlled by the parent.
 */
'use client';
import { Edit, Copy, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface TaskCardContextMenuProps {
  menuRef: React.RefObject<HTMLDivElement | null>;
  position: { x: number; y: number };
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/**
 * Right-click context menu for a task card.
 *
 * @param props - Ref, position, and action callbacks.
 */
export default function TaskCardContextMenu({
  menuRef,
  position,
  onEdit,
  onDuplicate,
  onDelete,
}: TaskCardContextMenuProps) {
  const tc = useTranslations('common');
  const tHome = useTranslations('home');

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={tc('edit')}
      className="fixed z-50 bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 py-1 min-w-40 animate-in fade-in duration-100"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
    >
      <button
        role="menuitem"
        onClick={onEdit}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-mono text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <Edit className="w-4 h-4" aria-hidden="true" />
        {tc('edit')}
      </button>
      <button
        role="menuitem"
        onClick={onDuplicate}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-mono text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <Copy className="w-4 h-4" aria-hidden="true" />
        {tHome('duplicate')}
      </button>
      <div
        role="separator"
        className="my-1 border-t border-slate-200 dark:border-slate-700"
      />
      <button
        role="menuitem"
        onClick={onDelete}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-mono text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
      >
        <Trash2 className="w-4 h-4" aria-hidden="true" />
        {tc('delete')}
      </button>
    </div>
  );
}
