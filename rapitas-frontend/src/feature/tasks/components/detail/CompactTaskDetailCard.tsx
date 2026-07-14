'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { type Task, type Resource, type Comment } from '@/types';
import TaskDescription from '@/feature/tasks/components/text/TaskDescription';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion/Accordion';
import FileUploader from '@/feature/tasks/components/FileUploader';
import NoteLinksSection from '@/app/tasks/[id]/components/NoteLinksSection';
import { Clock, FileText, Paperclip, Repeat, NotebookPen } from 'lucide-react';
import { useLocaleStore } from '@/stores/locale-store';
import { useFilterDataStore } from '@/stores/filter-data-store';
import { toDateLocale } from '@/lib/utils';
import InlineEditableText from '@/feature/tasks/components/text/InlineEditableText';
import {
  RecurrenceSelectorWithAccordionClose,
  toDateTimeLocal,
} from './CompactTaskDetailCard.helpers';
import { useCompactTaskDetailActions } from './useCompactTaskDetailActions';
import { sumSubtaskActualHours } from '@/utils/subtask-hours';
import CompactTaskDetailHeader from './CompactTaskDetailHeader';
import CompactTaskDetailWorkloadSection from './CompactTaskDetailWorkloadSection';

interface CompactTaskDetailCardProps {
  task: Task;
  onStatusUpdate: (taskId: number, newStatus: string) => void;
  onTaskUpdated?: () => void;
  resources?: Resource[];
  onResourcesChange?: () => void;
  // Memo-related props
  comments?: Comment[];
  newComment?: string;
  isAddingComment?: boolean;
  onNewCommentChange?: (v: string) => void;
  onAddComment?: (content?: string, parentId?: number) => void;
  onUpdateComment?: (id: number, content: string) => Promise<void>;
  onDeleteComment?: (id: number) => void;
  onCreateLink?: (from: number, to: number, label?: string) => Promise<void>;
  onDeleteLink?: (id: number) => Promise<void>;
}

export default function CompactTaskDetailCard({
  task,
  onStatusUpdate,
  onTaskUpdated,
  resources = [],
  onResourcesChange,
}: CompactTaskDetailCardProps) {
  const t = useTranslations('task');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);

  // NOTE: Task list API returns theme without nested category. Look up category
  // from the filter store (which persists full category/theme data including icons).
  const filterThemes = useFilterDataStore((s) => s.themes);
  const filterCategories = useFilterDataStore((s) => s.categories);
  const resolvedTheme = filterThemes.find((t) => t.id === task.themeId);
  const resolvedCategory = resolvedTheme?.categoryId
    ? filterCategories.find((c) => c.id === resolvedTheme.categoryId)
    : null;
  const resolvedCategoryName = resolvedCategory?.name ?? task.theme?.category?.name ?? '';
  const fileResources = resources.filter(
    (r) => r.filePath || r.type === 'file' || r.type === 'image' || r.type === 'pdf',
  );

  const [estHoursInput, setEstHoursInput] = useState(task.estimatedHours?.toString() ?? '');
  const [actHoursInput, setActHoursInput] = useState(task.actualHours?.toString() ?? '');
  const [dueDateInput, setDueDateInput] = useState(
    task.dueDate ? toDateTimeLocal(task.dueDate) : '',
  );

  // NOTE: Sync local inputs when the parent refreshes the task object.
  useEffect(() => {
    setEstHoursInput(task.estimatedHours?.toString() ?? '');
    setActHoursInput(task.actualHours?.toString() ?? '');
    setDueDateInput(task.dueDate ? toDateTimeLocal(task.dueDate) : '');
  }, [task.estimatedHours, task.actualHours, task.dueDate]);

  const { patchTask, saveField, toggleProtected, insertLinkToDescription, updateLabels } =
    useCompactTaskDetailActions({ task, onTaskUpdated });

  // Parent work time shows the subtask total whenever subtasks have hours
  // registered (falls back to the task's own actualHours otherwise).
  const displayActualHours = sumSubtaskActualHours(task.subtasks) ?? task.actualHours;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      {/* Header: Title & Status in one compact row */}
      <div className="p-4">
        <CompactTaskDetailHeader
          task={task}
          t={t}
          onStatusUpdate={onStatusUpdate}
          saveField={saveField}
          toggleProtected={toggleProtected}
        />
      </div>

      {/* Accordion sections */}
      <Accordion
        defaultExpanded={['description']}
        allowMultiple={true}
        className="border-t border-zinc-100 dark:border-zinc-800"
      >
        {/* Description - Default expanded; double-click to edit, blur to save */}
        <AccordionItem id="description">
          <AccordionTrigger id="description" icon={<FileText className="w-4 h-4" />}>
            {t('description')}
          </AccordionTrigger>
          <AccordionContent id="description">
            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4">
              <InlineEditableText
                value={task.description ?? ''}
                onSave={(v) => saveField('description', v)}
                multiline
                placeholder={t('compactTaskDetailCard.descriptionPlaceholder')}
                ariaLabel={t('compactTaskDetailCard.descriptionAriaLabel')}
                className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
                renderDisplay={(v) => (
                  <TaskDescription description={v} isCompact={true} maxInitialLength={300} />
                )}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Workload & Deadline - always visible so users can set values */}
        <AccordionItem id="meta">
          <AccordionTrigger
            id="meta"
            icon={<Clock className="w-4 h-4" />}
            badge={
              <span className="text-xs text-zinc-500 dark:text-zinc-500">
                {[
                  task.estimatedHours
                    ? t('compactTaskDetailCard.estimateBadge', { hours: task.estimatedHours })
                    : null,
                  displayActualHours != null
                    ? t('compactTaskDetailCard.actualBadge', {
                        hours: displayActualHours.toFixed(1),
                      })
                    : null,
                  task.dueDate ? new Date(task.dueDate).toLocaleDateString(dateLocale) : null,
                ]
                  .filter(Boolean)
                  .join(' / ')}
              </span>
            }
          >
            {t('compactTaskDetailCard.workloadDeadlineHeading')}
          </AccordionTrigger>
          <AccordionContent id="meta">
            <CompactTaskDetailWorkloadSection
              task={task}
              t={t}
              estHoursInput={estHoursInput}
              setEstHoursInput={setEstHoursInput}
              actHoursInput={actHoursInput}
              setActHoursInput={setActHoursInput}
              dueDateInput={dueDateInput}
              setDueDateInput={setDueDateInput}
              patchTask={patchTask}
              onLabelsChange={updateLabels}
            />
          </AccordionContent>
        </AccordionItem>

        {/* Recurrence Settings - Collapsible */}
        <AccordionItem id="recurrence">
          <AccordionTrigger
            id="recurrence"
            icon={<Repeat className="w-4 h-4" />}
            badge={
              task.isRecurring ? (
                <span className="px-1.5 py-0.5 text-xs font-medium bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-full">
                  {t('compactTaskDetailCard.recurrenceConfiguredBadge')}
                </span>
              ) : undefined
            }
          >
            {t('compactTaskDetailCard.recurrenceHeading')}
          </AccordionTrigger>
          <AccordionContent id="recurrence">
            <RecurrenceSelectorWithAccordionClose task={task} onTaskUpdated={onTaskUpdated} />
          </AccordionContent>
        </AccordionItem>

        {/* Attachments - Collapsible */}
        <AccordionItem id="attachments">
          <AccordionTrigger
            id="attachments"
            icon={<Paperclip className="w-4 h-4" />}
            badge={
              fileResources.length > 0 ? (
                <span className="px-1.5 py-0.5 text-xs font-medium bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400 rounded-full">
                  {fileResources.length}
                </span>
              ) : undefined
            }
          >
            {t('compactTaskDetailCard.attachmentsHeading')}
          </AccordionTrigger>
          <AccordionContent id="attachments">
            {onResourcesChange ? (
              <FileUploader
                taskId={task.id}
                resources={resources}
                onResourcesChange={onResourcesChange}
              />
            ) : (
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                {t('compactTaskDetailCard.attachmentsPermissionHint')}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Notes - Collapsible */}
        <AccordionItem id="memos">
          <AccordionTrigger id="memos" icon={<NotebookPen className="w-4 h-4" />}>
            {t('compactTaskDetailCard.notesHeading')}
          </AccordionTrigger>
          <AccordionContent id="memos">
            <NoteLinksSection
              taskId={task.id}
              taskTitle={task.title}
              themeName={task.theme?.name}
              categoryName={resolvedCategoryName}
              onInsertToDescription={insertLinkToDescription}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Created / updated timestamps — quiet meta footer as right-aligned,
          compact chips. */}
      <div className="flex flex-wrap items-center justify-end gap-1.5 px-4 py-2.5 border-t border-zinc-100 dark:border-zinc-800">
        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
          <span className="font-medium text-zinc-500 dark:text-zinc-500">
            {t('compactTaskDetailCard.createdChip')}
          </span>
          {new Date(task.createdAt).toLocaleString(dateLocale)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
          <span className="font-medium text-zinc-500 dark:text-zinc-500">
            {t('compactTaskDetailCard.updatedChip')}
          </span>
          {new Date(task.updatedAt).toLocaleString(dateLocale)}
        </span>
      </div>
    </div>
  );
}
