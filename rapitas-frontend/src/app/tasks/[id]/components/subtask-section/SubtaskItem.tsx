'use client';

/**
 * SubtaskItem
 *
 * A single row in the subtask list. Renders either a compact view-mode row
 * or delegates to SubtaskEditForm when this item is being edited.
 */

import { Pencil, CheckSquare, Square, Bot, Clock } from 'lucide-react';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/status/SubtaskExecutionStatus';
import PriorityIcon from '@/feature/tasks/components/priority/PriorityIcon';
import TaskStatusChange from '@/feature/tasks/components/status/TaskStatusChange';
import { useExecutionStateStore } from '@/stores/execution-state-store';
import { getStatusDisplay, renderStatusIcon } from '@/feature/tasks/config/StatusConfig';
import { useTranslations } from 'next-intl';
import { getLabelsArray, hasLabels } from '@/utils/labels';
import { SubtaskEditForm } from './SubtaskEditForm';
import type { Task, Priority } from '@/types';

type Subtask = NonNullable<Task['subtasks']>[number];

interface SubtaskItemProps {
  subtask: Subtask;
  isEditing: boolean;
  isSelectionMode: boolean;
  isSelected: boolean;
  isParallelExecutionRunning: boolean;
  executionStatus: ParallelExecutionStatus | undefined;
  editingSubtaskTitle: string;
  editingSubtaskDescription: string;
  editingSubtaskPriority: Priority;
  editingSubtaskLabels: string;
  editingSubtaskEstimatedHours: string;
  onToggleSelection: () => void;
  onStartEditing: (subtask: Subtask) => void;
  onSetEditingTitle: (v: string) => void;
  onSetEditingDescription: (v: string) => void;
  onSetEditingPriority: (v: Priority) => void;
  onSetEditingLabels: (v: string) => void;
  onSetEditingEstimatedHours: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  /** @param id - subtask id / サブタスクID */
  onUpdateStatus: (id: number, status: string) => void;
}

/**
 * Row component for an individual subtask in view or edit mode.
 *
 * @param props - SubtaskItemProps
 */
export function SubtaskItem({
  subtask,
  isEditing,
  isSelectionMode,
  isSelected,
  isParallelExecutionRunning,
  executionStatus,
  editingSubtaskTitle,
  editingSubtaskDescription,
  editingSubtaskPriority,
  editingSubtaskLabels,
  editingSubtaskEstimatedHours,
  onToggleSelection,
  onStartEditing,
  onSetEditingTitle,
  onSetEditingDescription,
  onSetEditingPriority,
  onSetEditingLabels,
  onSetEditingEstimatedHours,
  onSaveEdit,
  onCancelEdit,
  onUpdateStatus,
}: SubtaskItemProps) {
  const t = useTranslations('task');

  // Live agent-execution state for THIS subtask (from GET /tasks/executing polling).
  // Sequential subtasks each run their own agent, so the running one shows a spinner.
  const liveExecStatus = useExecutionStateStore((s) => s.getExecutingTaskStatus(subtask.id));
  // A finished subtask must never show the running spinner even if a stale
  // execution-state entry lingers (e.g. an orphaned agentExecution row the
  // /tasks/executing poll still returns) — trust the persisted terminal status.
  const isTerminalSubtask = subtask.status === 'done';
  const showRunning =
    !isTerminalSubtask &&
    (liveExecStatus !== null || (isParallelExecutionRunning && executionStatus === 'running'));

  return (
    <div
      className={`transition-colors ${
        isSelectionMode && isSelected
          ? 'bg-indigo-50 dark:bg-indigo-950/20 ring-1 ring-indigo-500 dark:ring-indigo-400'
          : ''
      }`}
    >
      {isEditing ? (
        <SubtaskEditForm
          editingSubtaskTitle={editingSubtaskTitle}
          editingSubtaskDescription={editingSubtaskDescription}
          editingSubtaskPriority={editingSubtaskPriority}
          editingSubtaskLabels={editingSubtaskLabels}
          editingSubtaskEstimatedHours={editingSubtaskEstimatedHours}
          onSetEditingTitle={onSetEditingTitle}
          onSetEditingDescription={onSetEditingDescription}
          onSetEditingPriority={onSetEditingPriority}
          onSetEditingLabels={onSetEditingLabels}
          onSetEditingEstimatedHours={onSetEditingEstimatedHours}
          onSaveEdit={onSaveEdit}
          onCancelEdit={onCancelEdit}
        />
      ) : (
        <div className="p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {isSelectionMode && (
                <button
                  onClick={onToggleSelection}
                  className="shrink-0"
                  aria-label={isSelected ? t('deselect') : t('select')}
                  aria-pressed={isSelected}
                >
                  {isSelected ? (
                    <CheckSquare className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  ) : (
                    <Square className="w-5 h-5 text-zinc-500" />
                  )}
                </button>
              )}
              {!isSelectionMode && (
                <div className="shrink-0">
                  {(() => {
                    // Mirror the task-list status icon exactly: StatusConfig colours
                    // + renderStatusIcon glyph in a rounded box, and — when the
                    // subtask is in-progress/running — the same outer-border
                    // spinning loader the task list uses (icon-outer-border-spin).
                    const cfg = getStatusDisplay(t, subtask.status);
                    return (
                      <div
                        className={`relative flex w-6 h-6 items-center justify-center rounded-md ${cfg.color} ${cfg.bgColor} border ${cfg.borderColor.replaceAll('border-l-', 'border-')}`}
                        aria-label={cfg.label}
                      >
                        {/* Spinner only while an agent is actually executing this
                            subtask — not for a manually-set in-progress status. */}
                        {showRunning && (
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
                    );
                  })()}
                </div>
              )}
              <span
                className={`text-sm truncate ${subtask.status === 'done' ? 'text-zinc-500 line-through' : 'text-zinc-900 dark:text-zinc-50'}`}
              >
                {subtask.title}
              </span>
              <PriorityIcon priority={subtask.priority} size="sm" />
              {subtask.agentGenerated && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded shrink-0">
                  <Bot className="w-3 h-3" />
                  AI
                </span>
              )}
              {hasLabels(subtask.labels) && (
                <div className="hidden sm:flex gap-1 shrink-0">
                  {getLabelsArray(subtask.labels)
                    .slice(0, 2)
                    .map((label, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
                      >
                        {label}
                      </span>
                    ))}
                  {getLabelsArray(subtask.labels).length > 2 && (
                    <span className="text-[10px] px-1 py-0.5 text-zinc-500">
                      +{getLabelsArray(subtask.labels).length - 2}
                    </span>
                  )}
                </div>
              )}
              {subtask.estimatedHours && (
                <span className="hidden sm:inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300 shrink-0">
                  <Clock className="w-2.5 h-2.5" />
                  {subtask.estimatedHours}h
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {(['todo', 'in-progress', 'done'] as const).map((status) => {
                const config = getStatusDisplay(t, status);
                return (
                  <TaskStatusChange
                    key={status}
                    status={status}
                    currentStatus={subtask.status}
                    config={config}
                    renderIcon={renderStatusIcon}
                    onClick={(newStatus) => onUpdateStatus(subtask.id, newStatus)}
                    size="sm"
                  />
                );
              })}
              <button
                onClick={() => onStartEditing(subtask)}
                className="flex items-center justify-center rounded-lg p-1.5 text-zinc-500 dark:text-zinc-500 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-400 transition-colors"
                title={t('subtaskDetails')}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
