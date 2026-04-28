'use client';
// SubtaskForm
import { Flag, Clock, Tag, Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Priority } from '@/types';
import { PrioritySelector } from './PrioritySelector';
import { usePriorityOptions } from './PrioritySelector';

interface SubtaskFormProps {
  title: string;
  description: string;
  priority: Priority;
  labels: string;
  estimatedHours: string;
  onTitleChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onPriorityChange: (v: Priority) => void;
  onLabelsChange: (v: string) => void;
  onEstimatedHoursChange: (v: string) => void;
  /** Commits the pending subtask to the list. */
  onAdd: () => void;
  /** Clears all subtask form fields without adding. */
  onReset: () => void;
}

/**
 * Form fields for composing a single subtask before the parent task is saved.
 *
 * @param props - All controlled field values and change handlers.
 */
export function SubtaskForm({
  title,
  description,
  priority,
  labels,
  estimatedHours,
  onTitleChange,
  onDescriptionChange,
  onPriorityChange,
  onLabelsChange,
  onEstimatedHoursChange,
  onAdd,
  onReset,
}: SubtaskFormProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');
  const priorityOptions = usePriorityOptions(t);

  return (
    <div className="mb-3 p-4 rounded-lg bg-emerald-50/30 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/30">
      <div className="space-y-4">
        {/* Title */}
        <div>
          <input
            type="text"
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && title.trim()) {
                e.preventDefault();
                onAdd();
              } else if (e.key === 'Escape') {
                onReset();
              }
            }}
            placeholder={t('addSubtaskPlaceholder')}
          />
        </div>

        {/* Description */}
        <div>
          <textarea
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder={t('subtaskDescriptionPlaceholder')}
            rows={3}
          />
        </div>

        {/* Priority */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
            <Flag className="w-3.5 h-3.5" />
            {t('subtaskPriority')}
          </label>
          <PrioritySelector
            value={priority}
            onChange={onPriorityChange}
            options={priorityOptions}
          />
        </div>

        {/* Estimated hours + labels row */}
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
              value={estimatedHours}
              onChange={(e) => onEstimatedHoursChange(e.target.value)}
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
              value={labels}
              onChange={(e) => onLabelsChange(e.target.value)}
            />
          </div>
        </div>

        {/* Save / Cancel buttons */}
        <div className="flex items-center gap-2 pt-1">
          <div
            className={`relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 ${
              !title.trim()
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:border-emerald-500 dark:hover:border-emerald-400'
            }`}
          >
            <button
              type="button"
              onClick={onAdd}
              disabled={!title.trim()}
              className={`flex items-center gap-2 transition-all ${
                !title.trim()
                  ? 'cursor-not-allowed text-gray-400 dark:text-gray-600'
                  : 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 cursor-pointer'
              }`}
            >
              <Check className="w-4 h-4" />
              <span className="font-mono text-xs font-black tracking-tight">{tc('save')}</span>
            </button>
          </div>

          <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-gray-500 dark:hover:border-gray-400">
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
              <span className="font-mono text-xs font-black tracking-tight">{tc('cancel')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
