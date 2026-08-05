'use client';
// SubtaskForm — mirrors the task detail page's AddSubtaskForm design.
import { useRef } from 'react';
import { Flag, Clock, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Priority } from '@/types';
import { useAutosizeTextarea } from '@/hooks/ui/useAutosizeTextarea';
import { isImeComposing } from '@/utils/ime';
import { PrioritySelector } from './PrioritySelector';
import { usePriorityOptions } from './PrioritySelector';

interface SubtaskFormProps {
  title: string;
  description: string;
  priority: Priority;
  estimatedHours: string;
  onTitleChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onPriorityChange: (v: Priority) => void;
  onEstimatedHoursChange: (v: string) => void;
  /** Commits the pending subtask to the list. */
  onAdd: () => void;
  /** Clears all subtask form fields without adding. */
  onReset: () => void;
}

/**
 * Form fields for composing a single subtask before the parent task is saved.
 * NOTE: No label input — subtask labels are configured on the parent task.
 *
 * @param props - All controlled field values and change handlers.
 */
export function SubtaskForm({
  title,
  description,
  priority,
  estimatedHours,
  onTitleChange,
  onDescriptionChange,
  onPriorityChange,
  onEstimatedHoursChange,
  onAdd,
  onReset,
}: SubtaskFormProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');
  const priorityOptions = usePriorityOptions(t);

  // Grow the description field with its content instead of scrolling inside a
  // fixed 3-row box (same behaviour as the detail page's AddSubtaskForm).
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextarea(descriptionRef, description);

  return (
    <div className="mb-3 space-y-4">
      {/* Title */}
      <input
        type="text"
        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:border-indigo-400"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && title.trim() && !isImeComposing(e)) {
            e.preventDefault();
            onAdd();
          } else if (e.key === 'Escape') {
            onReset();
          }
        }}
        placeholder={t('addSubtaskPlaceholder')}
        aria-label={t('addSubtaskPlaceholder')}
      />

      {/* Description */}
      <textarea
        ref={descriptionRef}
        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:border-indigo-400 resize-none overflow-hidden"
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        placeholder={t('subtaskDescriptionPlaceholder')}
        aria-label={t('subtaskDescriptionPlaceholder')}
        rows={3}
      />

      {/* Priority + Workload row */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
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
            value={estimatedHours}
            onChange={(e) => onEstimatedHoursChange(e.target.value)}
            aria-label={t('subtaskEstimatedHours')}
          />
        </div>
      </div>

      {/* Divider + right-aligned actions */}
      <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-700">
        <button
          type="button"
          onClick={onAdd}
          disabled={!title.trim()}
          className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-zinc-900 text-indigo-700 dark:text-indigo-300 shadow-[0_2px_0_0_#a5b4fc] dark:shadow-[0_2px_0_0_#1e1b4b] hover:bg-indigo-50 dark:hover:bg-indigo-900/20 active:translate-y-[1px] active:shadow-none transition-all duration-75 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:translate-y-0 disabled:active:shadow-[0_2px_0_0_#a5b4fc]"
        >
          <Save className="w-4 h-4" />
          <span className="font-mono font-black tracking-tight">{tc('save')}</span>
        </button>
      </div>
    </div>
  );
}
