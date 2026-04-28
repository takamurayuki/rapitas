'use client';

/**
 * SubtaskDeleteConfirm
 *
 * Inline confirmation banner displayed above the subtask list when a bulk delete is pending.
 * Stateless — parent controls visibility via `showSubtaskDeleteConfirm`.
 */

import { Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface SubtaskDeleteConfirmProps {
  /** Whether to confirm deletion of 'all' or 'selected' subtasks / 全削除か選択削除か */
  mode: 'all' | 'selected';
  totalCount: number;
  selectedCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Danger banner with confirm and cancel buttons for bulk subtask deletion.
 *
 * @param props - SubtaskDeleteConfirmProps
 */
export function SubtaskDeleteConfirm({
  mode,
  totalCount,
  selectedCount,
  onConfirm,
  onCancel,
}: SubtaskDeleteConfirmProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');

  return (
    <div className="p-4 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800">
      <p className="text-sm text-red-700 dark:text-red-300 mb-3">
        {mode === 'all'
          ? t('deleteAllConfirm', { count: totalCount })
          : t('deleteSelectedConfirm', { count: selectedCount })}
      </p>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-red-500 dark:hover:border-red-400 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
          <span className="font-mono text-xs font-black tracking-tight">{t('confirmDelete')}</span>
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-gray-500 dark:hover:border-gray-400 text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer"
        >
          <X className="w-4 h-4" />
          <span className="font-mono text-xs font-black tracking-tight">{tc('cancel')}</span>
        </button>
      </div>
    </div>
  );
}
