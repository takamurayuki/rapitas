'use client';

import { useState, useEffect } from 'react';
import { type Task, type Label, type Resource, type Comment, type Priority } from '@/types';
import { useToast } from '@/components/ui/toast/ToastContainer';
import TaskDescription from '@/feature/tasks/components/text/TaskDescription';
import TaskStatusChange from '@/feature/tasks/components/status/TaskStatusChange';
import { statusConfig, renderStatusIcon } from '@/feature/tasks/config/StatusConfig';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  useAccordionContext,
} from '@/components/ui/accordion/Accordion';
import { SelectedLabelsDisplay } from '@/feature/tasks/components/LabelSelector';
import FileUploader from '@/feature/tasks/components/FileUploader';
import NoteLinksSection from '@/app/tasks/[id]/components/NoteLinksSection';
import {
  Calendar,
  Clock,
  Timer,
  Tag,
  FileText,
  Paperclip,
  Repeat,
  NotebookPen,
  Lock,
  LockOpen,
} from 'lucide-react';
import PriorityInlineSelect from '@/feature/tasks/components/priority/PriorityInlineSelect';
import RecurrenceSelector from '@/feature/tasks/components/recurrence/RecurrenceSelector';
import { useLocaleStore } from '@/stores/locale-store';
import { useFilterDataStore } from '@/stores/filter-data-store';
import { useTaskCacheStore } from '@/stores/task-cache-store';
import { toDateLocale } from '@/lib/utils';
import { API_BASE_URL } from '@/utils/api';
import { clearApiCache } from '@/lib/api-client';
import InlineEditableText from '@/feature/tasks/components/text/InlineEditableText';

/**
 * Wrapper for RecurrenceSelector that can close the accordion
 */
function RecurrenceSelectorWithAccordionClose({
  task,
  onTaskUpdated,
}: {
  task: Task;
  onTaskUpdated?: () => void;
}) {
  const { toggleItem } = useAccordionContext();

  return (
    <RecurrenceSelector
      taskId={task.id}
      isRecurring={task.isRecurring ?? false}
      recurrenceRule={task.recurrenceRule ?? null}
      recurrenceEndAt={task.recurrenceEndAt ?? null}
      onUpdate={onTaskUpdated ?? (() => {})}
      onClose={() => toggleItem('recurrence')}
      inline={true}
    />
  );
}

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

/** Converts a UTC ISO string to a value suitable for a datetime-local input. */
function toDateTimeLocal(isoUtcString: string): string {
  const d = new Date(isoUtcString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CompactTaskDetailCard({
  task,
  onStatusUpdate,
  onTaskUpdated,
  resources = [],
  onResourcesChange,
  comments = [],
  newComment = '',
  isAddingComment = false,
  onNewCommentChange,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  onCreateLink,
  onDeleteLink,
}: CompactTaskDetailCardProps) {
  const { showToast } = useToast();
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);

  // NOTE: Task list API returns theme without nested category. Look up category
  // from the filter store (which persists full category/theme data including icons).
  const filterThemes = useFilterDataStore((s) => s.themes);
  const filterCategories = useFilterDataStore((s) => s.categories);
  const updateTaskLocally = useTaskCacheStore((s) => s.updateTaskLocally);
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

  /**
   * Patches a set of task fields and refreshes the parent view.
   *
   * @param data - Partial task fields to update / 更新するフィールドの部分オブジェクト
   */
  const patchTask = async (data: Record<string, unknown>) => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('update failed');
      // Reflect the change instantly in the shared cache so widgets like
      // TodayTaskProgressBar update without waiting for the next poll cycle.
      updateTaskLocally(task.id, data as Partial<import('@/types').Task>);
      clearApiCache(`/tasks/${task.id}`);
      onTaskUpdated?.();
    } catch {
      showToast('保存に失敗しました', 'error');
    }
  };

  /**
   * Persists a single inline-edited field (title/description) via PATCH, then
   * refreshes the task. Mirrors the full-edit save path.
   *
   * @param field - Field to update / 更新するフィールド
   * @param value - New value / 新しい値
   */
  const saveField = async (field: 'title' | 'description' | 'priority', value: string) => {
    await patchTask({ [field]: value });
  };

  /**
   * Toggles the task's deletion-protection flag via PATCH and refreshes the view.
   * Reuses patchTask so cache invalidation + parent refresh behave identically
   * to the inline field edits above.
   */
  const toggleProtected = async () => {
    await patchTask({ isProtected: !task.isProtected });
  };

  /**
   * Appends a markdown link to the task description and persists via PATCH.
   * Prepends a newline when there is existing content.
   *
   * @param link - Markdown link string / 挿入するMarkdownリンク
   */
  const insertLinkToDescription = async (link: string) => {
    const current = task.description ?? '';
    const next = current.trim() ? `${current}\n${link}` : link;
    await patchTask({ description: next });
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      {/* Header: Title & Status in one compact row */}
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          {/* Title with Priority Icon */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <InlineEditableText
              value={task.title}
              onSave={(v) => saveField('title', v)}
              required
              ariaLabel="タスクのタイトル"
              className="flex-1 min-w-0 text-xl font-bold text-zinc-900 dark:text-zinc-50 leading-tight truncate"
            />
            <PriorityInlineSelect
              value={task.priority as Priority}
              onChange={(p) => saveField('priority', p)}
            />
            <button
              type="button"
              onClick={toggleProtected}
              title={task.isProtected ? '保護を解除する' : 'タスクを保護する（削除不可）'}
              aria-label={task.isProtected ? '保護を解除する' : 'タスクを保護する（削除不可）'}
              aria-pressed={task.isProtected ?? false}
              className="flex items-center rounded p-0.5 outline-none transition-colors hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-zinc-800"
            >
              {task.isProtected ? (
                <Lock size={16} className="text-amber-500 dark:text-amber-400" />
              ) : (
                <LockOpen size={16} className="text-zinc-400 dark:text-zinc-500" />
              )}
            </button>
          </div>

          {/* Status Buttons - Compact inline with title.
              Normalize so the active button always highlights: `blocked` is an
              internal mid-workflow state shown as 進行中 (see StatusConfig), and
              legacy `completed` maps to `done`. Without this, such tasks render
              with NO status selected. */}
          <div className="flex items-center gap-1 shrink-0">
            {(['todo', 'in-progress', 'done'] as const).map((status) => {
              const config = statusConfig[status];
              // `task.status` is typed to the 3 toggle values, but at runtime it
              // can also be 'blocked'/'completed' — compare as string to normalize.
              const rawStatus = task.status as string;
              const normalizedCurrent =
                rawStatus === 'blocked'
                  ? 'in-progress'
                  : rawStatus === 'completed'
                    ? 'done'
                    : task.status;
              return (
                <TaskStatusChange
                  key={status}
                  status={status}
                  currentStatus={normalizedCurrent}
                  config={config}
                  renderIcon={renderStatusIcon}
                  onClick={(newStatus) => onStatusUpdate(task.id, newStatus)}
                  size="sm"
                  showLabel={false}
                />
              );
            })}
          </div>
        </div>
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
            説明
          </AccordionTrigger>
          <AccordionContent id="description">
            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4">
              <InlineEditableText
                value={task.description ?? ''}
                onSave={(v) => saveField('description', v)}
                multiline
                placeholder="説明を追加（ダブルクリックで編集）"
                ariaLabel="タスクの説明"
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
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                {[
                  task.estimatedHours ? `見積: ${task.estimatedHours}h` : null,
                  task.actualHours != null ? `実績: ${task.actualHours.toFixed(1)}h` : null,
                  task.dueDate ? new Date(task.dueDate).toLocaleDateString(dateLocale) : null,
                ]
                  .filter(Boolean)
                  .join(' / ')}
              </span>
            }
          >
            工数・期限
          </AccordionTrigger>
          <AccordionContent id="meta">
            {/* NOTE: Use local input state for the progress bar so it updates on keystroke,
                not only after the parent re-fetches the task on blur. */}
            {(() => {
              const displayedEst = estHoursInput ? parseFloat(estHoursInput) : null;
              const displayedAct = actHoursInput ? parseFloat(actHoursInput) : 0;
              const hasEst = displayedEst != null && displayedEst > 0;
              const pct = hasEst ? Math.min(100, (displayedAct / displayedEst) * 100) : 0;
              const barColor = !hasEst
                ? 'bg-green-500/30'
                : displayedAct > displayedEst
                  ? 'bg-red-500'
                  : displayedAct >= displayedEst * 0.8
                    ? 'bg-amber-500'
                    : 'bg-green-500';
              return (
                <div className="space-y-4">
                  {/* 工数 / 作業時間 / 期限 — 3列横並び */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          工数
                        </span>
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          value={estHoursInput}
                          onChange={(e) => setEstHoursInput(e.target.value)}
                          onBlur={() =>
                            patchTask({
                              estimatedHours: estHoursInput ? parseFloat(estHoursInput) : null,
                            })
                          }
                          placeholder="0"
                          className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-lg px-2 py-1.5 text-sm border-none outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
                        />
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 shrink-0">h</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                        <span className="flex items-center gap-1">
                          <Timer className="w-3.5 h-3.5" />
                          作業時間
                        </span>
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={actHoursInput}
                          onChange={(e) => setActHoursInput(e.target.value)}
                          onBlur={() =>
                            patchTask({
                              actualHours: actHoursInput ? parseFloat(actHoursInput) : null,
                            })
                          }
                          placeholder="0"
                          className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-lg px-2 py-1.5 text-sm border-none outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                        />
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 shrink-0">h</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          期限
                        </span>
                      </label>
                      <input
                        type="datetime-local"
                        value={dueDateInput}
                        onChange={(e) => setDueDateInput(e.target.value)}
                        onBlur={() =>
                          patchTask({
                            dueDate: dueDateInput ? new Date(dueDateInput).toISOString() : null,
                          })
                        }
                        className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-lg px-2 py-1.5 text-sm border-none outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
                      />
                    </div>
                  </div>

                  {/* 進捗バー: 作業時間 / 工数 (入力値をリアルタイム反映) */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        進捗
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {displayedAct.toFixed(1)}h{hasEst ? ` / ${displayedEst}h` : ''}
                        {hasEst && (
                          <span className="ml-1 text-zinc-400 dark:text-zinc-500">
                            ({pct.toFixed(0)}%)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-150 ${barColor}`}
                        style={{ width: hasEst ? `${pct}%` : displayedAct > 0 ? '100%' : '0%' }}
                      />
                    </div>
                  </div>

                  {/* Labels (read-only display) */}
                  {task.taskLabels && task.taskLabels.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                        <span className="flex items-center gap-1">
                          <Tag className="w-3.5 h-3.5" />
                          ラベル
                        </span>
                      </label>
                      <SelectedLabelsDisplay
                        labels={task.taskLabels
                          .map((tl) => tl.label)
                          .filter((l): l is Label => l !== undefined)}
                      />
                    </div>
                  )}
                </div>
              );
            })()}
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
                  設定済み
                </span>
              ) : undefined
            }
          >
            繰り返し設定
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
            添付ファイル
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
                ファイルの追加には編集権限が必要です
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Notes - Collapsible */}
        <AccordionItem id="memos">
          <AccordionTrigger id="memos" icon={<NotebookPen className="w-4 h-4" />}>
            ノート
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
          <span className="font-medium text-zinc-400 dark:text-zinc-500">作成</span>
          {new Date(task.createdAt).toLocaleString(dateLocale)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
          <span className="font-medium text-zinc-400 dark:text-zinc-500">更新</span>
          {new Date(task.updatedAt).toLocaleString(dateLocale)}
        </span>
      </div>
    </div>
  );
}
