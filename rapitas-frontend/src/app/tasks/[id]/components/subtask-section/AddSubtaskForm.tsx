'use client';

/**
 * AddSubtaskForm
 *
 * Inline form for adding a new subtask, shown below the SubtaskHeader when active.
 * Does not persist data — delegates to parent via callbacks.
 */

import { useRef } from 'react';
import { Save, Clock, Timer, Flag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Priority } from '@/types';
import { useAutosizeTextarea } from '@/hooks/ui/useAutosizeTextarea';
import { isImeComposing } from '@/utils/ime';
import { PrioritySelector } from '@/app/tasks/new/components/PrioritySelector';
import DurationInput from '@/components/ui/hours-minutes-input/HoursMinutesInput';

interface AddSubtaskFormProps {
  newSubtaskTitle: string;
  newSubtaskDescription: string;
  newSubtaskPriority: Priority;
  newSubtaskEstimatedHours: string;
  newSubtaskActualHours: string;
  onSetNewSubtaskTitle: (v: string) => void;
  onSetNewSubtaskDescription: (v: string) => void;
  onSetNewSubtaskPriority: (v: Priority) => void;
  onSetNewSubtaskEstimatedHours: (v: string) => void;
  onSetNewSubtaskActualHours: (v: string) => void;
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
  newSubtaskPriority,
  newSubtaskEstimatedHours,
  newSubtaskActualHours,
  onSetNewSubtaskTitle,
  onSetNewSubtaskDescription,
  onSetNewSubtaskPriority,
  onSetNewSubtaskEstimatedHours,
  onSetNewSubtaskActualHours,
  onAddSubtask,
}: AddSubtaskFormProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');

  // Grow the description field with its content instead of scrolling inside a
  // fixed 3-row box.
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextarea(descriptionRef, newSubtaskDescription);

  return (
    // NOTE: No top border — the subtask list above closes itself with border-b.
    <div className="bg-zinc-50/50 dark:bg-zinc-900/30">
      <div className="p-4 space-y-4">
        <div>
          <input
            type="text"
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:border-indigo-400"
            value={newSubtaskTitle}
            onChange={(e) => onSetNewSubtaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSubtaskTitle.trim() && !isImeComposing(e)) {
                onAddSubtask();
              }
            }}
            placeholder={t('addSubtaskPlaceholder')}
            aria-label={t('addSubtaskPlaceholder')}
            autoFocus
          />
        </div>

        <div>
          <textarea
            ref={descriptionRef}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:border-indigo-400 resize-none overflow-hidden"
            value={newSubtaskDescription}
            onChange={(e) => onSetNewSubtaskDescription(e.target.value)}
            placeholder={t('subtaskDescriptionPlaceholder')}
            aria-label={t('subtaskDescriptionPlaceholder')}
            rows={3}
          />
        </div>

        {/* NOTE: No label input — subtask labels are configured on the parent task. */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
              <Flag className="w-3.5 h-3.5" />
              {t('subtaskPriority')}
            </label>
            {/* Shared selector — same design as the new-task page (§7 reuse). */}
            <PrioritySelector value={newSubtaskPriority} onChange={onSetNewSubtaskPriority} />
          </div>

          <div className="w-full sm:w-36">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
              <Clock className="w-3.5 h-3.5" />
              {t('subtaskEstimatedHours')}
            </label>
            <DurationInput
              value={newSubtaskEstimatedHours}
              onChange={onSetNewSubtaskEstimatedHours}
              aria-label={t('subtaskEstimatedHours')}
            />
          </div>

          <div className="w-full sm:w-36">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
              <Timer className="w-3.5 h-3.5" />
              {t('subtaskActualHours')}
            </label>
            <DurationInput
              value={newSubtaskActualHours}
              onChange={onSetNewSubtaskActualHours}
              aria-label={t('subtaskActualHours')}
            />
          </div>
        </div>
      </div>

      {/* Full-bleed footer — edge-to-edge divider + tinted band so the action
          row reads as a distinct section (matches the edit form). */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-100/70 dark:bg-zinc-900/60">
        <button
          onClick={onAddSubtask}
          disabled={!newSubtaskTitle.trim()}
          className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-zinc-900 text-indigo-700 dark:text-indigo-300 shadow-[0_2px_0_0_#a5b4fc] dark:shadow-[0_2px_0_0_#1e1b4b] hover:bg-indigo-50 dark:hover:bg-indigo-900/20 active:translate-y-[1px] active:shadow-none transition-all duration-75 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:translate-y-0 disabled:active:shadow-[0_2px_0_0_#a5b4fc]"
        >
          <Save className="w-4 h-4" />
          <span className="font-mono font-black tracking-tight">{tc('save')}</span>
        </button>
      </div>
    </div>
  );
}
