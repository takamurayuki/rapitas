/**
 * TaskCard
 *
 * Orchestrates the task card UI used in list views.
 * Delegates state and logic to useTaskCard, the context menu to
 * TaskCardContextMenu, and the expanded subtask panel to TaskCardSubtaskPanel.
 */
'use client';
import React, { useState, memo } from 'react';
import type { Task, Status } from '@/types';
import TaskStatusChange from '@/feature/tasks/components/TaskStatusChange';
import PriorityIcon from '@/feature/tasks/components/PriorityIcon';
import {
  statusConfig,
  renderStatusIcon,
} from '@/feature/tasks/config/StatusConfig';
import { ExternalLink, Tag, Repeat } from 'lucide-react';
import { getLabelsArray, hasLabels } from '@/utils/labels';
import { getIconComponent } from '@/components/category/icon-data';
import { CardLightSweep } from './TaskCompletionAnimation';
import { ModernCheckbox } from '@/components/ui/ModernCheckbox';
import { useTranslations } from 'next-intl';
import { useLocaleStore as _useLocaleStore } from '@/stores/locale-store';
import { useTaskCard } from './task-card/useTaskCard';
import TaskCardContextMenu from './task-card/TaskCardContextMenu';
import TaskCardSubtaskPanel from './task-card/TaskCardSubtaskPanel';
import { DependencyBadge } from './dependency';

interface TaskCardProps {
  task: Task;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onTaskClick: (taskId: number) => void;
  onStatusChange: (
    taskId: number,
    status: Status,
    cardElement?: HTMLElement,
  ) => void;
  onToggleSelect?: (taskId: number) => void;
  onTaskUpdated?: () => void;
  onOpenInPage?: (taskId: number) => void;
  sweepingTaskId?: number | null;
}

const TaskCard = memo(function TaskCard({
  task,
  isSelected = false,
  isSelectionMode = false,
  onTaskClick,
  onStatusChange,
  onToggleSelect,
  onTaskUpdated,
  onOpenInPage,
  sweepingTaskId,
}: TaskCardProps) {
  const t = useTranslations('task');
  const tHome = useTranslations('home');

  const tc = useTaskCard(task, onStatusChange, onTaskUpdated, onTaskClick);

  // NOTE: cardSize is kept local because it only drives the perimeter calculation
  // which is currently unused (_perimeter). Kept for future progress-ring feature.
  const [_cardSize, setCardSize] = useState({ w: 0, h: 0 });

  React.useEffect(() => {
    if (!tc.cardRef.current) return;
    const { width, height } = tc.cardRef.current.getBoundingClientRect();
    setCardSize({ w: width, h: height });
  }, [tc.cardRef]);

  return (
    <div
      ref={tc.cardRef}
      data-task-card
      onMouseEnter={tc.handleMouseEnter}
      className={`group relative z-0 rounded-lg border-l-4 border-t border-r border-b transition-all duration-300 ease-out hover:duration-200 ${
        isSelected
          ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-400 dark:border-purple-600 shadow-lg shadow-purple-200/50 dark:shadow-purple-900/50'
          : `${tc.cardBorderColor} border-zinc-200 dark:border-zinc-800 ${tc.currentStatus.bgColor} dark:bg-indigo-dark-900`
      } ${
        !isSelected
          ? 'hover:shadow-xl hover:scale-[1.02] hover:-translate-y-0.5 hover:border-opacity-80 dark:hover:shadow-2xl dark:hover:shadow-black/30'
          : ''
      } ${
        tc.executionClasses?.borderColor === 'blue'
          ? 'ai-glow-blue'
          : tc.executionClasses?.borderColor === 'amber'
            ? 'ai-glow-amber'
            : ''
      }`}
    >
      <CardLightSweep
        active={sweepingTaskId === task.id}
        colors={tc.sweepColors}
      />

      {/* Main row */}
      <div
        className="relative z-10 flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-all duration-300 ease-out hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 rounded-t-lg"
        onClick={() => {
          if (isSelectionMode && onToggleSelect) {
            onToggleSelect(task.id);
          } else {
            onTaskClick(task.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!isSelectionMode) {
            tc.setContextMenuPosition({ x: e.clientX, y: e.clientY });
            tc.setShowContextMenu(true);
          }
        }}
      >
        {/* Status icon / checkbox */}
        {isSelectionMode ? (
          <ModernCheckbox
            checked={isSelected || false}
            onChange={() => onToggleSelect?.(task.id)}
            onClick={(e) => e.stopPropagation()}
            className="mr-1"
            aria-label={`${t('select')} ${task.title}`}
          />
        ) : (
          <div
            className={`relative flex items-center justify-center w-7 h-7 rounded-md ${
              tc.isWaitingForInput
                ? tc.waitingAmberConfig.color
                : tc.currentStatus.color
            } ${
              tc.isWaitingForInput
                ? tc.waitingAmberConfig.bgColor
                : tc.currentStatus.bgColor
            } ${
              tc.executionStatus
                ? ''
                : `border-2 ${(tc.isWaitingForInput
                    ? tc.waitingAmberConfig.borderColor
                    : tc.currentStatus.borderColor
                  ).replace('border-l-', 'border-')}`
            } shrink-0`}
            aria-label={
              tc.isWaitingForInput
                ? tc.waitingAmberConfig.label
                : tc.currentStatus.label
            }
          >
            {(tc.executionStatus === 'running' ||
              tc.executionStatus === 'waiting_for_input') && (
              <svg
                className="absolute -inset-0.5 w-[calc(100%+4px)] h-[calc(100%+4px)] pointer-events-none"
                viewBox="0 0 32 32"
                fill="none"
              >
                <rect
                  x="1"
                  y="1"
                  width="30"
                  height="30"
                  rx="7"
                  stroke={
                    tc.executionStatus === 'waiting_for_input'
                      ? '#f59e0b'
                      : '#3b82f6'
                  }
                  strokeWidth="2"
                  strokeDasharray="20 87.96"
                  strokeLinecap="round"
                  fill="none"
                  style={{
                    animation: 'icon-outer-border-spin 1.5s linear infinite',
                    willChange: 'stroke-dashoffset',
                    transform: 'translateZ(0)',
                  }}
                  aria-hidden="true"
                />
              </svg>
            )}
            {renderStatusIcon(
              tc.isWaitingForInput ? 'in-progress' : task.status,
            )}
          </div>
        )}

        {/* Title + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <h3 className="font-medium text-zinc-900 dark:text-zinc-50 truncate text-sm">
                {task.title}
              </h3>
              <PriorityIcon priority={task.priority} size="md" />

              {task.isRecurring && (
                <span title="繰り返しタスク">
                  <Repeat
                    size={14}
                    className="text-indigo-500 dark:text-indigo-400 shrink-0"
                  />
                </span>
              )}

              {task.sourceTaskId && (
                <span
                  className="text-xs text-zinc-400 dark:text-zinc-500 shrink-0"
                  title="繰り返しから生成されたタスク"
                >
                  🔄
                </span>
              )}

              {tc.executionClasses && (
                <div
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium shrink-0 ${tc.executionClasses.badgeClass}`}
                  title={tc.executionClasses.label}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full execution-dot-pulse ${tc.executionClasses.dotClass}`}
                    aria-hidden="true"
                  />
                  <span>{tc.executionClasses.label}</span>
                </div>
              )}

              {/* Dependency Badge */}
              <DependencyBadge taskId={task.id} compact />
            </div>
          </div>

          {/* Subtask progress + meta badges */}
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            {tc.localSubtasks.length > 0 && (
              <>
                <div className="shrink-0 flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      tc.setExpandedSubtasks(!tc.expandedSubtasks);
                    }}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium flex items-center gap-1 transition-all duration-200 ease-out hover:scale-105"
                    aria-expanded={tc.expandedSubtasks}
                    aria-label={t('subtasks')}
                  >
                    <svg
                      className={`w-3 h-3 transition-transform duration-300 ease-out ${
                        tc.expandedSubtasks ? 'rotate-90' : ''
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                    {
                      tc.localSubtasks.filter((s) => s.status === 'done')
                        .length
                    }
                    /{tc.localSubtasks.length}
                  </button>
                  {tc.completionRate !== null && (
                    <div className="w-75 h-1 ml-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${tc.getProgressBarColor(tc.completionRate)} transition-all duration-700 ease-out`}
                        style={{ width: `${tc.completionRate}%` }}
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            {task.estimatedHours && (
              <>
                <span className="text-zinc-300 dark:text-zinc-700">•</span>
                <span className="shrink-0">{task.estimatedHours}h</span>
              </>
            )}

            {task.taskLabels && task.taskLabels.length > 0 ? (
              <>
                <span className="text-zinc-300 dark:text-zinc-700">•</span>
                <span className="flex items-center gap-1 shrink-0 flex-wrap">
                  {task.taskLabels.slice(0, 3).map((tl) => {
                    if (!tl.label) return null;
                    const IconComponent =
                      getIconComponent(tl.label.icon || '') || Tag;
                    return (
                      <span
                        key={tl.id}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{
                          backgroundColor: `${tl.label.color}20`,
                          color: tl.label.color,
                        }}
                        title={tl.label.name}
                      >
                        <IconComponent className="w-2.5 h-2.5" />
                        {tl.label.name}
                      </span>
                    );
                  })}
                  {task.taskLabels.length > 3 && (
                    <span className="text-zinc-500 dark:text-zinc-400 text-[10px]">
                      +{task.taskLabels.length - 3}
                    </span>
                  )}
                </span>
              </>
            ) : hasLabels(task.labels) ? (
              <>
                <span className="text-zinc-300 dark:text-zinc-700">•</span>
                <span className="inline-flex items-center gap-0.5 shrink-0">
                  <Tag className="w-3 h-3" />
                  {getLabelsArray(task.labels).length}
                </span>
              </>
            ) : null}
          </div>
        </div>

        {/* Status change buttons */}
        {!isSelectionMode && (
          <div
            className="flex items-center gap-1 pl-3 self-stretch"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            {['todo', 'in-progress', 'done'].map((status) => {
              // NOTE: Amber override applied to in-progress button when task is waiting_for_input
              const baseConfig =
                statusConfig[status as keyof typeof statusConfig];
              const config =
                tc.isWaitingForInput && status === 'in-progress'
                  ? { ...baseConfig, ...tc.waitingAmberConfig }
                  : baseConfig;
              return (
                <TaskStatusChange
                  key={status}
                  status={status}
                  currentStatus={task.status}
                  config={config}
                  renderIcon={renderStatusIcon}
                  onClick={(s: string) =>
                    onStatusChange(
                      task.id,
                      s as Status,
                      tc.cardRef.current || undefined,
                    )
                  }
                  size="md"
                />
              );
            })}
            {onOpenInPage && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenInPage(task.id);
                }}
                className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-all duration-200 ease-out hover:scale-110"
                aria-label={tHome('openInPage')}
              >
                <ExternalLink className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Context menu */}
      {tc.showContextMenu && (
        <TaskCardContextMenu
          menuRef={tc.contextMenuRef}
          position={tc.contextMenuPosition}
          onEdit={() => {
            onTaskClick(task.id);
            tc.setShowContextMenu(false);
          }}
          onDuplicate={tc.duplicateTask}
          onDelete={tc.deleteTask}
        />
      )}

      {/* Expanded subtask panel */}
      {tc.expandedSubtasks && tc.localSubtasks.length > 0 && (
        <TaskCardSubtaskPanel
          subtasks={tc.localSubtasks}
          onTaskUpdated={onTaskUpdated}
          onStatusChange={tc.handleSubtaskStatusChange}
        />
      )}
    </div>
  );
});

export default TaskCard;
