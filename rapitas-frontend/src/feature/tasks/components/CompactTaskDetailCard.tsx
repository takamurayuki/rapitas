'use client';

import { Task, Label, Resource, Comment } from '@/types';
import TaskDescription from '@/feature/tasks/components/TaskDescription';
import TaskStatusChange from '@/feature/tasks/components/TaskStatusChange';
import {
  statusConfig,
  renderStatusIcon,
} from '@/feature/tasks/config/StatusConfig';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  useAccordionContext,
} from '@/components/ui/accordion/Accordion';
import { SelectedLabelsDisplay } from '@/feature/tasks/components/LabelSelector';
import FileUploader from '@/feature/tasks/components/FileUploader';
import MemoSection from '@/feature/tasks/components/MemoSection';
import {
  Clock,
  Calendar,
  Tag,
  FileText,
  Info,
  Paperclip,
  StickyNote,
  Repeat,
} from 'lucide-react';
import PriorityIcon from '@/feature/tasks/components/PriorityIcon';
import RecurrenceSelector from '@/feature/tasks/components/RecurrenceSelector';
import { useLocaleStore } from '@/stores/localeStore';
import { toDateLocale } from '@/lib/utils';

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
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);
  const fileResources = resources.filter(
    (r) =>
      r.filePath || r.type === 'file' || r.type === 'image' || r.type === 'pdf',
  );
  const hasMetaInfo =
    (task.taskLabels && task.taskLabels.length > 0) || task.estimatedHours;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800 overflow-hidden">
      {/* Header: Title & Status in one compact row */}
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          {/* Title with Priority Icon */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 leading-tight truncate">
              {task.title}
            </h1>
            <PriorityIcon priority={task.priority} size="md" />
          </div>

          {/* Status Buttons - Compact inline with title */}
          <div className="flex items-center gap-1 shrink-0">
            {(['todo', 'in-progress', 'done'] as const).map((status) => {
              const config = statusConfig[status];
              return (
                <TaskStatusChange
                  key={status}
                  status={status}
                  currentStatus={task.status}
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
        {/* Description - Default expanded */}
        {task.description && (
          <AccordionItem id="description">
            <AccordionTrigger
              id="description"
              icon={<FileText className="w-4 h-4" />}
            >
              説明
            </AccordionTrigger>
            <AccordionContent id="description">
              <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-4">
                <TaskDescription
                  description={task.description}
                  isCompact={true}
                  maxInitialLength={300}
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Meta Information - Collapsible */}
        {hasMetaInfo && (
          <AccordionItem id="meta">
            <AccordionTrigger
              id="meta"
              icon={<Tag className="w-4 h-4" />}
              badge={
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  {task.taskLabels?.length || 0} labels
                  {task.estimatedHours ? ` / ${task.estimatedHours}h` : ''}
                </span>
              }
            >
              ラベル・見積もり
            </AccordionTrigger>
            <AccordionContent id="meta">
              <div className="flex flex-wrap items-center gap-3">
                {task.taskLabels && task.taskLabels.length > 0 && (
                  <SelectedLabelsDisplay
                    labels={task.taskLabels
                      .map((tl) => tl.label)
                      .filter((l): l is Label => l !== undefined)}
                  />
                )}
                {task.estimatedHours && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-sm font-medium">
                    <Clock className="w-3.5 h-3.5" />
                    {task.estimatedHours}時間
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Details with AI Features - Collapsible */}
        <AccordionItem id="details">
          <AccordionTrigger
            id="details"
            icon={<Info className="w-4 h-4" />}
            badge={
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                更新: {new Date(task.updatedAt).toLocaleDateString(dateLocale)}
              </span>
            }
          >
            詳細情報
          </AccordionTrigger>
          <AccordionContent id="details">
            {/* Timestamps */}
            <div className="flex flex-wrap items-center gap-4 pt-3 text-sm text-zinc-500 dark:text-zinc-400">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                <span>
                  作成: {new Date(task.createdAt).toLocaleString(dateLocale)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>
                  更新: {new Date(task.updatedAt).toLocaleString(dateLocale)}
                </span>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Recurrence Settings - Collapsible */}
        <AccordionItem id="recurrence">
          <AccordionTrigger
            id="recurrence"
            icon={<Repeat className="w-4 h-4" />}
            badge={
              task.isRecurring ? (
                <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-full">
                  設定済み
                </span>
              ) : undefined
            }
          >
            繰り返し設定
          </AccordionTrigger>
          <AccordionContent id="recurrence">
            <RecurrenceSelectorWithAccordionClose
              task={task}
              onTaskUpdated={onTaskUpdated}
            />
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

        {/* Memos - Collapsible */}
        <AccordionItem id="memos">
          <AccordionTrigger
            id="memos"
            icon={<StickyNote className="w-4 h-4" />}
            badge={
              comments.filter((c) => !c.parentId).length > 0 ? (
                <span className="px-1.5 py-0.5 text-xs font-medium bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400 rounded-full">
                  {comments.filter((c) => !c.parentId).length}
                </span>
              ) : undefined
            }
          >
            メモ
          </AccordionTrigger>
          <AccordionContent id="memos">
            <MemoSection
              comments={comments}
              newComment={newComment}
              isAddingComment={isAddingComment}
              taskId={task.id}
              onNewCommentChange={onNewCommentChange || (() => {})}
              onAddComment={onAddComment || (() => {})}
              onUpdateComment={onUpdateComment || (async () => {})}
              onDeleteComment={onDeleteComment || (() => {})}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
