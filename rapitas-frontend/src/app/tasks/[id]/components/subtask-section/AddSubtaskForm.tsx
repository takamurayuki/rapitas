'use client';

/**
 * AddSubtaskForm
 *
 * Inline form for adding a new subtask, shown below the SubtaskHeader when active.
 * Does not persist data — delegates to parent via callbacks.
 */

import { Check, Clock, Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface AddSubtaskFormProps {
  newSubtaskTitle: string;
  newSubtaskDescription: string;
  newSubtaskLabels: string;
  newSubtaskEstimatedHours: string;
  onSetNewSubtaskTitle: (v: string) => void;
  onSetNewSubtaskDescription: (v: string) => void;
  onSetNewSubtaskLabels: (v: string) => void;
  onSetNewSubtaskEstimatedHours: (v: string) => void;
  onAddSubtask: () => void;
}

/**
 * Always-visible inline form for adding a new subtask below the list.
 *
 * @param props - AddSubtaskFormProps
 */
export function AddSubtaskForm({
  newSubtaskTitle,
  newSubtaskDescription,
  newSubtaskLabels,
  newSubtaskEstimatedHours,
  onSetNewSubtaskTitle,
  onSetNewSubtaskDescription,
  onSetNewSubtaskLabels,
  onSetNewSubtaskEstimatedHours,
  onAddSubtask,
}: AddSubtaskFormProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');

  return (
    <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30">
      <div className="space-y-4">
        <div>
          <input
            type="text"
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:border-indigo-400"
            value={newSubtaskTitle}
            onChange={(e) => onSetNewSubtaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSubtaskTitle.trim()) {
                onAddSubtask();
              }
            }}
            placeholder={t('addSubtaskPlaceholder')}
            autoFocus
          />
        </div>

        <div>
          <textarea
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:border-indigo-400"
            value={newSubtaskDescription}
            onChange={(e) => onSetNewSubtaskDescription(e.target.value)}
            placeholder={t('subtaskDescriptionPlaceholder')}
            rows={3}
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="w-full sm:w-36">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
              <Clock className="w-3.5 h-3.5" />
              {t('subtaskEstimatedHours')}
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:border-indigo-400"
              placeholder="0"
              value={newSubtaskEstimatedHours}
              onChange={(e) => onSetNewSubtaskEstimatedHours(e.target.value)}
            />
          </div>

          <div className="flex-1">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
              <Tag className="w-3.5 h-3.5" />
              {t('subtaskLabels')}
            </label>
            <input
              type="text"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:border-indigo-400"
              placeholder={t('labelsCommaSeparated')}
              value={newSubtaskLabels}
              onChange={(e) => onSetNewSubtaskLabels(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onAddSubtask}
            disabled={!newSubtaskTitle.trim()}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-zinc-900 text-indigo-700 dark:text-indigo-300 shadow-[0_2px_0_0_#a5b4fc] dark:shadow-[0_2px_0_0_#1e1b4b] hover:bg-indigo-50 dark:hover:bg-indigo-900/20 active:translate-y-[1px] active:shadow-none transition-all duration-75 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:translate-y-0 disabled:active:shadow-[0_2px_0_0_#a5b4fc]"
          >
            <Check className="w-4 h-4" />
            <span className="font-mono font-black tracking-tight">{tc('save')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
