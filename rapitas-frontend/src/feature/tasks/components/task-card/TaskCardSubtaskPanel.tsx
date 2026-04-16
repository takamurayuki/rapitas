'use client';
// TaskCardSubtaskPanel
import type { Task } from '@/types';
import SubtaskStatusButtons from '@/feature/tasks/components/SubtaskStatusButtons';
import {
  statusConfig,
  renderStatusIcon,
} from '@/feature/tasks/config/StatusConfig';

interface TaskCardSubtaskPanelProps {
  subtasks: Task[];
  onTaskUpdated?: () => void;
  onStatusChange: (subtaskId: number, newStatus: string) => void;
}

/**
 * Inline list of subtasks with status icons and quick-change buttons.
 *
 * @param props - The subtask array and status-change callbacks.
 */
export default function TaskCardSubtaskPanel({
  subtasks,
  onTaskUpdated,
  onStatusChange,
}: TaskCardSubtaskPanelProps) {
  return (
    <div
      className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-indigo-dark-900/50 p-3"
      onClick={(e) => e.stopPropagation()}
    >
      {subtasks.map((subtask, index) => {
        const subtaskStatus =
          statusConfig[subtask.status as keyof typeof statusConfig] ||
          statusConfig.todo;
        const isFirst = index === 0;
        const isLast = index === subtasks.length - 1;
        const roundedClass =
          isFirst && isLast
            ? 'rounded-md'
            : isFirst
              ? 'rounded-t-md'
              : isLast
                ? 'rounded-b-md'
                : '';
        return (
          <div
            key={subtask.id}
            className={`flex items-center gap-2 p-2 ${roundedClass} transition-colors border-l-2 ${subtaskStatus.borderColor} ${subtaskStatus.bgColor} dark:bg-indigo-dark-900`}
          >
            <div
              className={`flex items-center justify-center w-6 h-6 rounded ${
                subtaskStatus.color
              } ${subtaskStatus.bgColor} border ${subtaskStatus.borderColor.replace(
                'border-l-',
                'border-',
              )} shrink-0`}
              aria-label={subtaskStatus.label}
            >
              {renderStatusIcon(subtask.status)}
            </div>
            <span
              className={`flex-1 text-sm ${
                subtask.status === 'done'
                  ? 'line-through text-zinc-500 dark:text-zinc-500'
                  : 'text-zinc-700 dark:text-zinc-300'
              }`}
            >
              {subtask.title}
            </span>
            <SubtaskStatusButtons
              taskId={subtask.id}
              currentStatus={subtask.status}
              onTaskUpdated={onTaskUpdated}
              onStatusChange={onStatusChange}
              size="sm"
            />
          </div>
        );
      })}
    </div>
  );
}
