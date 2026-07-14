'use client';

/**
 * SubtaskHeader
 *
 * Header row for the SubtaskSection card: title, add-form visibility toggle,
 * and bulk-select controls (select-all toggle + mode toggle while selecting).
 * The bulk delete action lives in SubtaskSection's selection footer.
 * Owns no state — all callbacks are passed from the parent.
 */

import { ListTodo, ListPlus, CopyCheck, CircleCheckBig, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Task } from '@/types';

interface SubtaskHeaderProps {
  subtasks: NonNullable<Task['subtasks']>;
  isSubtaskSelectionMode: boolean;
  selectedSubtaskIds: Set<number>;
  onToggleSelectionMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  /** Whether the add-subtask form below the list is currently shown. */
  isAddFormVisible: boolean;
  onToggleAddForm: () => void;
}

/**
 * Header bar with subtask count plus the bulk-select toggle; bulk actions live
 * in a separate toolbar band while selecting.
 *
 * @param props - SubtaskHeaderProps
 */
export function SubtaskHeader({
  subtasks,
  isSubtaskSelectionMode,
  selectedSubtaskIds,
  onToggleSelectionMode,
  onSelectAll,
  onDeselectAll,
  isAddFormVisible,
  onToggleAddForm,
}: SubtaskHeaderProps) {
  const t = useTranslations('task');
  // Bulk labels/tooltips reuse the task list's existing keys (home namespace)
  // so both screens read identically.
  const tHome = useTranslations('home');

  const allSelected = subtasks.length > 0 && selectedSubtaskIds.size === subtasks.length;

  return (
    <div className="border-b border-zinc-100 dark:border-zinc-800">
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50">
          {/* ListTodo (matches the quick-nav subtask icon) reads as "subtasks",
              unlike a check mark which implies the section is complete. */}
          <ListTodo className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-bold">{t('subtasks')}</h2>
        </div>

        {/* Header keeps ONLY mode/view toggles — the destructive bulk action
            lives in the card's selection footer so the row never crowds. */}
        <div className="flex items-center gap-2">
          {/* 追加フォームの表示/非表示 — ボトムリッジ (インディゴ=アクティブ)。
              表示中は押し込んだまま。選択モード中は追加操作ごと隠す。
              ListPlus = タスク起票 (同一概念の再利用)。 */}
          {!isSubtaskSelectionMode && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleAddForm();
              }}
              title={t('toggleAddSubtaskForm')}
              aria-label={t('toggleAddSubtaskForm')}
              aria-pressed={isAddFormVisible}
              className={`flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium rounded-lg select-none text-indigo-700 dark:text-indigo-300 border transition-all duration-75 ${
                isAddFormVisible
                  ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-300 dark:border-indigo-700 translate-y-[1px] shadow-none'
                  : 'bg-white dark:bg-zinc-900 border-indigo-200 dark:border-indigo-800 shadow-[0_2px_0_0_#a5b4fc] dark:shadow-[0_2px_0_0_#312e81] hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-300 dark:hover:border-indigo-700 active:translate-y-[1px] active:shadow-none'
              }`}
            >
              <ListPlus className="w-3.5 h-3.5" />
              {t('addSubtask')}
            </button>
          )}

          {/* すべて選択⇄すべて解除 — 単一トグル。選択モード中のみ
              「選択中 (n件)」の左に表示。文言・アイコンともタスク一覧と同一。 */}
          {isSubtaskSelectionMode && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (allSelected) {
                  onDeselectAll();
                } else {
                  onSelectAll();
                }
              }}
              title={allSelected ? tHome('deselectAll') : tHome('selectAll')}
              className="flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium rounded-lg select-none text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150"
            >
              {allSelected ? (
                <X className="w-3.5 h-3.5" />
              ) : (
                <CircleCheckBig className="w-3.5 h-3.5" />
              )}
              {allSelected ? tHome('deselectAll') : tHome('selectAll')}
            </button>
          )}

          {/* 追加フォームが開いている間は一括ボタンを隠す — 追加と一括選択は
              相互排他のモード。 */}
          {subtasks.length > 0 && (isSubtaskSelectionMode || !isAddFormVisible) && (
            /* 一括選択 — ボトムリッジ (紫)。選択モード中は押し込んだまま。
               タスク一覧 (HomeToolbar) と同じデザイン。CopyCheck = 一括選択モード。 */
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelectionMode();
              }}
              title={t('bulkSelect')}
              className={`flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium rounded-lg select-none text-purple-700 dark:text-purple-300 border transition-all duration-75 ${
                isSubtaskSelectionMode
                  ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700 translate-y-[1px] shadow-none'
                  : 'bg-white dark:bg-zinc-900 border-purple-200 dark:border-purple-800 shadow-[0_2px_0_0_#d8b4fe] dark:shadow-[0_2px_0_0_#4c1d95] hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-300 dark:hover:border-purple-700 active:translate-y-[1px] active:shadow-none'
              }`}
            >
              <CopyCheck className="w-3.5 h-3.5" />
              {isSubtaskSelectionMode
                ? t('selecting', { count: selectedSubtaskIds.size })
                : t('bulkSelect')}
            </button>
          )}
        </div>
      </div>

      {/* NOTE: 一括ステータス変更は撤去 (2026-07-14、サブタスクでは稀なため)。
          削除はカード下部の選択フッター (SubtaskSection) に移動。 */}
    </div>
  );
}
