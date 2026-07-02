/**
 * CompactTaskDetailHeader
 *
 * Title/priority/protection/status row shown at the top of
 * CompactTaskDetailCard. Extracted from the card component to keep it under
 * the size limit; markup and behavior are unchanged.
 */
'use client';
import { type useTranslations } from 'next-intl';
import { type Task, type Priority } from '@/types';
import InlineEditableText from '@/feature/tasks/components/text/InlineEditableText';
import PriorityInlineSelect from '@/feature/tasks/components/priority/PriorityInlineSelect';
import TaskStatusChange from '@/feature/tasks/components/status/TaskStatusChange';
import { getStatusDisplay, renderStatusIcon } from '@/feature/tasks/config/StatusConfig';
import { Lock, LockOpen } from 'lucide-react';

export interface CompactTaskDetailHeaderProps {
  task: Task;
  /** `useTranslations('task')` from the parent — kept as a prop to avoid a duplicate hook call. */
  t: ReturnType<typeof useTranslations<'task'>>;
  onStatusUpdate: (taskId: number, newStatus: string) => void;
  saveField: (field: 'title' | 'description' | 'priority', value: string) => Promise<void>;
  toggleProtected: () => Promise<void>;
}

/** Title/priority/protection/status row at the top of CompactTaskDetailCard. */
export default function CompactTaskDetailHeader({
  task,
  t,
  onStatusUpdate,
  saveField,
  toggleProtected,
}: CompactTaskDetailHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      {/* Title with Priority Icon */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <InlineEditableText
          value={task.title}
          onSave={(v) => saveField('title', v)}
          required
          ariaLabel={t('compactTaskDetailCard.titleAriaLabel')}
          className="flex-1 min-w-0 text-xl font-bold text-zinc-900 dark:text-zinc-50 leading-tight truncate"
        />
        <PriorityInlineSelect
          value={task.priority as Priority}
          onChange={(p) => saveField('priority', p)}
        />
        <button
          type="button"
          onClick={toggleProtected}
          title={
            task.isProtected
              ? t('compactTaskDetailCard.unprotectTitle')
              : t('compactTaskDetailCard.protectTitle')
          }
          aria-label={
            task.isProtected
              ? t('compactTaskDetailCard.unprotectTitle')
              : t('compactTaskDetailCard.protectTitle')
          }
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
          const config = getStatusDisplay(t, status);
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
  );
}
