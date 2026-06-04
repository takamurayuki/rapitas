'use client';
// TaskCardSubtaskPanel
import type { Task } from '@/types';
import SubtaskStatusButtons from '@/feature/tasks/components/SubtaskStatusButtons';
import {
  statusConfig,
  renderStatusIcon,
  isInProgressStatus,
} from '@/feature/tasks/config/StatusConfig';
import { useExecutionStateStore } from '@/stores/execution-state-store';

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
  // Live agent-execution state (GET /tasks/executing polling). The spinner is
  // driven by THIS — actual agent execution — not the in-progress status.
  const executingTasks = useExecutionStateStore((s) => s.executingTasks);
  return (
    <div
      className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-indigo-dark-900/50 p-3"
      onClick={(e) => e.stopPropagation()}
    >
      {subtasks.map((subtask, index) => {
        const subtaskStatus =
          statusConfig[subtask.status as keyof typeof statusConfig] || statusConfig.todo;
        // in-progress STATUS drives the box look; agent EXECUTION drives the spinner.
        const inProgress = isInProgressStatus(subtask.status);
        const liveStatus = executingTasks.get(subtask.id)?.status;
        const isExecuting = liveStatus === 'running' || liveStatus === 'waiting_for_input';
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
              className={`relative flex items-center justify-center w-6 h-6 rounded ${
                subtaskStatus.color
              } ${subtaskStatus.bgColor} ${
                inProgress
                  ? ''
                  : `border ${subtaskStatus.borderColor.replace('border-l-', 'border-')}`
              } shrink-0`}
              aria-label={subtaskStatus.label}
            >
              {/* Spinner only while an agent is actually executing this subtask
                  (not for a manually-set in-progress status). */}
              {isExecuting && (
                <svg
                  className="absolute -inset-0.5 w-[calc(100%+4px)] h-[calc(100%+4px)] pointer-events-none"
                  viewBox="0 0 32 32"
                  fill="none"
                  aria-hidden="true"
                >
                  <rect
                    x="1"
                    y="1"
                    width="30"
                    height="30"
                    rx="7"
                    stroke="#3b82f6"
                    strokeWidth="2"
                    strokeDasharray="20 87.96"
                    strokeLinecap="round"
                    fill="none"
                    style={{
                      animation: 'icon-outer-border-spin 1.5s linear infinite',
                      willChange: 'stroke-dashoffset',
                      transform: 'translateZ(0)',
                    }}
                  />
                </svg>
              )}
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
