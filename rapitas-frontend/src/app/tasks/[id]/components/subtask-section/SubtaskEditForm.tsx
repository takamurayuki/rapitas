'use client';

/**
 * SubtaskEditForm
 *
 * Expanded inline edit panel for a single subtask.
 * Rendered in place of the subtask row when editing is active.
 */

import { useRef } from 'react';
import { Save, X, Clock, Timer, AlertTriangle, NotebookPen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Task, Priority } from '@/types';
import { useAutosizeTextarea } from '@/hooks/ui/useAutosizeTextarea';
import { PrioritySelector } from '@/app/tasks/new/components/PrioritySelector';
import NoteLinksSection from '../NoteLinksSection';

interface SubtaskEditFormProps {
  /** The subtask being edited — needed so notes can be linked to its ID. */
  subtask: NonNullable<Task['subtasks']>[number];
  editingSubtaskTitle: string;
  editingSubtaskDescription: string;
  editingSubtaskPriority: Priority;
  editingSubtaskEstimatedHours: string;
  editingSubtaskActualHours: string;
  onSetEditingTitle: (v: string) => void;
  onSetEditingDescription: (v: string) => void;
  onSetEditingPriority: (v: Priority) => void;
  onSetEditingEstimatedHours: (v: string) => void;
  onSetEditingActualHours: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  /** Parent task's theme name — note-link hierarchy metadata. */
  themeName?: string;
  /** Parent task's category name — note-link hierarchy metadata. */
  categoryName?: string;
}

/**
 * Form panel for editing an existing subtask's title, description, priority,
 * hours, and linked notes.
 *
 * @param props - SubtaskEditFormProps
 */
export function SubtaskEditForm({
  subtask,
  editingSubtaskTitle,
  editingSubtaskDescription,
  editingSubtaskPriority,
  editingSubtaskEstimatedHours,
  editingSubtaskActualHours,
  onSetEditingTitle,
  onSetEditingDescription,
  onSetEditingPriority,
  onSetEditingEstimatedHours,
  onSetEditingActualHours,
  onSaveEdit,
  onCancelEdit,
  themeName,
  categoryName,
}: SubtaskEditFormProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');

  // Grow the description field with its content — including when a note link
  // is inserted programmatically below (state change, not a keystroke).
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextarea(descriptionRef, editingSubtaskDescription);

  // Mirrors the parent card's insert behavior: append on a new line, but here
  // into the DRAFT description — persisted only when the user saves.
  const insertLinkToDescription = (link: string) => {
    onSetEditingDescription(
      editingSubtaskDescription.trim() ? `${editingSubtaskDescription}\n${link}` : link,
    );
  };

  return (
    <div className="p-4 bg-zinc-50/50 dark:bg-zinc-800/20">
      <div className="space-y-4">
        <input
          type="text"
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:border-indigo-400"
          value={editingSubtaskTitle}
          onChange={(e) => onSetEditingTitle(e.target.value)}
          placeholder={t('subtaskTitle')}
          aria-label={t('subtaskTitle')}
          autoFocus
        />

        <textarea
          ref={descriptionRef}
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:border-indigo-400 resize-none overflow-hidden"
          value={editingSubtaskDescription}
          onChange={(e) => onSetEditingDescription(e.target.value)}
          placeholder={t('descriptionMarkdown')}
          aria-label={t('descriptionMarkdown')}
          rows={3}
        />

        {/* Notes sit directly under the description so the "insert to
            description" action lands right next to its target field. */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
            <NotebookPen className="w-3.5 h-3.5" />
            {t('compactTaskDetailCard.notesHeading')}
          </label>
          <NoteLinksSection
            taskId={subtask.id}
            taskTitle={editingSubtaskTitle || subtask.title}
            themeName={themeName}
            categoryName={categoryName}
            onInsertToDescription={insertLinkToDescription}
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {t('subtaskPriority')}
            </label>
            {/* Shared selector — same design as the new-task page (§7 reuse). */}
            <PrioritySelector value={editingSubtaskPriority} onChange={onSetEditingPriority} />
          </div>

          {/* NOTE: No label input — subtask labels are configured on the parent task. */}
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
              value={editingSubtaskEstimatedHours}
              onChange={(e) => onSetEditingEstimatedHours(e.target.value)}
              aria-label={t('subtaskEstimatedHours')}
            />
          </div>

          <div className="w-full sm:w-36">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
              <Timer className="w-3.5 h-3.5" />
              {t('subtaskActualHours')}
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:border-indigo-400"
              placeholder="0"
              value={editingSubtaskActualHours}
              onChange={(e) => onSetEditingActualHours(e.target.value)}
              aria-label={t('subtaskActualHours')}
            />
          </div>
        </div>

        {/* NOTE: Buttons mirror AddSubtaskForm's raised-shadow style so the edit
            and add forms read as the same control family. */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onSaveEdit}
            disabled={!editingSubtaskTitle.trim()}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-zinc-900 text-indigo-700 dark:text-indigo-300 shadow-[0_2px_0_0_#a5b4fc] dark:shadow-[0_2px_0_0_#1e1b4b] hover:bg-indigo-50 dark:hover:bg-indigo-900/20 active:translate-y-[1px] active:shadow-none transition-all duration-75 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:translate-y-0 disabled:active:shadow-[0_2px_0_0_#a5b4fc]"
          >
            <Save className="w-4 h-4" />
            <span className="font-mono font-black tracking-tight">{tc('save')}</span>
          </button>
          <button
            onClick={onCancelEdit}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 shadow-[0_2px_0_0_#d4d4d8] dark:shadow-[0_2px_0_0_#27272a] hover:bg-zinc-50 dark:hover:bg-zinc-800/40 active:translate-y-[1px] active:shadow-none transition-all duration-75"
          >
            <X className="w-4 h-4" />
            <span className="font-mono font-black tracking-tight">{tc('cancel')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
