/**
 * SubtaskListHeader
 *
 * Renders the subtask section header: title with completion count, selection/delete
 * action buttons, delete-confirmation banner, and the progress bar.
 * All state is received via props; no local state owned here.
 */
import { useTranslations } from 'next-intl';
import { Pencil as _Pencil, X, Trash2, CheckSquare, Square as _Square } from 'lucide-react';

interface SubtaskListHeaderProps {
  totalSubtasks: number;
  completedCount: number;
  progressPercentage: number;
  isSelectionMode: boolean;
  selectedCount: number;
  showDeleteConfirm: 'all' | 'selected' | null;
  hasDeleteAll: boolean;
  hasDeleteSelected: boolean;
  onToggleSelectionMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onRequestDeleteSelected: () => void;
  onRequestDeleteAll: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

/**
 * Header for the subtask list section including progress bar and bulk controls.
 *
 * @param props - Subtask counts, selection state, and delete/selection handlers.
 */
export default function SubtaskListHeader({
  totalSubtasks,
  completedCount,
  progressPercentage,
  isSelectionMode,
  selectedCount,
  showDeleteConfirm,
  hasDeleteAll,
  hasDeleteSelected,
  onToggleSelectionMode,
  onSelectAll,
  onDeselectAll,
  onRequestDeleteSelected,
  onRequestDeleteAll,
  onConfirmDelete,
  onCancelDelete,
}: SubtaskListHeaderProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          {t('subtasks')}
          {totalSubtasks > 0 && (
            <span className="ml-3 text-base font-normal text-zinc-500">
              {t('subtasksCompleted', {
                count: `${completedCount}/${totalSubtasks}`,
              })}
            </span>
          )}
        </h2>

        {totalSubtasks > 0 && (hasDeleteAll || hasDeleteSelected) && (
          <div className="flex items-center gap-2">
            {hasDeleteSelected && (
              <button
                onClick={onToggleSelectionMode}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  isSelectionMode
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                {isSelectionMode ? (
                  <>
                    <X className="w-4 h-4" />
                    {t('deselect')}
                  </>
                ) : (
                  <>
                    <CheckSquare className="w-4 h-4" />
                    {t('select')}
                  </>
                )}
              </button>
            )}

            {isSelectionMode && (
              <>
                <button
                  onClick={selectedCount === totalSubtasks ? onDeselectAll : onSelectAll}
                  className="px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  {selectedCount === totalSubtasks ? t('deselectAll') : t('selectAll')}
                </button>
                {selectedCount > 0 && (
                  <button
                    onClick={onRequestDeleteSelected}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    {t('deleteCount', { count: selectedCount })}
                  </button>
                )}
              </>
            )}

            {!isSelectionMode && hasDeleteAll && (
              <button
                onClick={onRequestDeleteAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                {t('deleteAll')}
              </button>
            )}
          </div>
        )}
      </div>

      {showDeleteConfirm && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-700 dark:text-red-300 mb-3">
            {showDeleteConfirm === 'all'
              ? t('deleteAllConfirm', { count: totalSubtasks })
              : t('deleteSelectedConfirm', { count: selectedCount })}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onConfirmDelete}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
            >
              {t('confirmDelete')}
            </button>
            <button
              onClick={onCancelDelete}
              className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            >
              {tc('cancel')}
            </button>
          </div>
        </div>
      )}

      {totalSubtasks > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400 mb-2">
            <span>{t('progress')}</span>
            <span className="font-medium">{progressPercentage}%</span>
          </div>
          <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-300"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
