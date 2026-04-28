'use client';

/**
 * AddSubtaskForm
 *
 * Inline form for adding a new subtask, shown below the SubtaskHeader when active.
 * Does not persist data — delegates to parent via callbacks.
 */

import { Check, X, Clock, Tag } from 'lucide-react';
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
  onCancelAddSubtask: () => void;
}

/**
 * Expandable inline form for creating a new subtask.
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
  onCancelAddSubtask,
}: AddSubtaskFormProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');

  return (
    <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 bg-emerald-50/30 dark:bg-emerald-950/20">
      <div className="space-y-4">
        <div>
          <input
            type="text"
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400"
            value={newSubtaskTitle}
            onChange={(e) => onSetNewSubtaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSubtaskTitle.trim()) {
                onAddSubtask();
              } else if (e.key === 'Escape') {
                onCancelAddSubtask();
              }
            }}
            placeholder={t('addSubtaskPlaceholder')}
            autoFocus
          />
        </div>

        <div>
          <textarea
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400"
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
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400"
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
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400"
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
            className={`flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 ${
              !newSubtaskTitle.trim()
                ? 'opacity-50 cursor-not-allowed text-gray-400 dark:text-gray-600'
                : 'hover:border-emerald-500 dark:hover:border-emerald-400 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 cursor-pointer'
            }`}
          >
            <Check className="w-4 h-4" />
            <span className="font-mono text-xs font-black tracking-tight">{tc('save')}</span>
          </button>
          <button
            onClick={onCancelAddSubtask}
            className="flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-gray-500 dark:hover:border-gray-400 text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer"
          >
            <X className="w-4 h-4" />
            <span className="font-mono text-xs font-black tracking-tight">{tc('cancel')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
