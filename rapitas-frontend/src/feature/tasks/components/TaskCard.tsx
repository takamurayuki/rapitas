'use client';
import React, { useState, useRef, useEffect, memo } from 'react';
import type { Task, Status } from '@/types';
import TaskStatusChange from '@/feature/tasks/components/TaskStatusChange';
import SubtaskStatusButtons from '@/feature/tasks/components/SubtaskStatusButtons';
import PriorityIcon from '@/feature/tasks/components/PriorityIcon';
import {
  statusConfig,
  renderStatusIcon,
} from '@/feature/tasks/config/StatusConfig';
import { ExternalLink, Tag, Copy, Trash2, Edit, Repeat } from 'lucide-react';
import { getLabelsArray, hasLabels } from '@/utils/labels';
import { getIconComponent } from '@/components/category/IconData';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { API_BASE_URL } from '@/utils/api';
import { CardLightSweep, useProgressColors } from './TaskCompletionAnimation';
import { prefetch } from '@/lib/api-client';
import { ModernCheckbox } from '@/components/ui/ModernCheckbox';
import { useExecutionStateStore } from '@/stores/executionStateStore';
import { useTranslations } from 'next-intl';
import { createLogger } from '@/lib/logger';
import { useLocaleStore } from '@/stores/localeStore';

const logger = createLogger('TaskCard');

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
  const tc = useTranslations('common');
  const tHome = useTranslations('home');
  const _locale = useLocaleStore((s) => s.locale);
  const cardRef = useRef<HTMLDivElement>(null);
  const [expandedSubtasks, setExpandedSubtasks] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({
    x: 0,
    y: 0,
  });
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();
  const prefetchedRef = useRef(false);

  // Get execution status
  const executionStatus = useExecutionStateStore((state) =>
    state.getExecutingTaskStatus(task.id),
  );

  // Manage subtask state locally
  const [localSubtasks, setLocalSubtasks] = useState(task.subtasks || []);

  // Update localSubtasks when task prop changes
  useEffect(() => {
    setLocalSubtasks(task.subtasks || []);
  }, [task.subtasks]);

  const handleSubtaskStatusChange = (subtaskId: number, newStatus: string) => {
    // Optimistic UI update: immediately update local state
    setLocalSubtasks((prevSubtasks) =>
      prevSubtasks.map((subtask) =>
        subtask.id === subtaskId
          ? { ...subtask, status: newStatus as Status }
          : subtask,
      ),
    );

    // Call parent component's onStatusChange (API request)
    onStatusChange(subtaskId, newStatus as Status);
  };

  // Rollback on subtask status change failure
  const _rollbackSubtaskStatus = (
    subtaskId: number,
    originalStatus: string,
  ) => {
    setLocalSubtasks((prevSubtasks) =>
      prevSubtasks.map((subtask) =>
        subtask.id === subtaskId
          ? { ...subtask, status: originalStatus as Status }
          : subtask,
      ),
    );
  };

  const currentStatus =
    statusConfig[task.status as keyof typeof statusConfig] || statusConfig.todo;
  const completionRate = localSubtasks.length
    ? Math.round(
        (localSubtasks.filter((s) => s.status === 'done').length /
          localSubtasks.length) *
          100,
      )
    : null;

  const getProgressBarColor = (rate: number) => {
    if (rate === 100) return 'bg-green-500';
    if (rate >= 80) return 'bg-gradient-to-r from-blue-500 to-green-500';
    if (rate >= 50) return 'bg-blue-500';
    return 'bg-gradient-to-r from-blue-500 to-orange-500';
  };

  // CSS classes and badge info based on execution state
  const getExecutionClasses = () => {
    switch (executionStatus) {
      case 'running':
        return {
          borderColor: 'blue' as const,
          badgeClass:
            'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300',
          dotClass: 'bg-blue-500',
          label: t('running'),
        };
      case 'waiting_for_input':
        return {
          borderColor: 'amber' as const,
          badgeClass:
            'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300',
          dotClass: 'bg-amber-500',
          label: t('waitingForInput'),
        };
      default:
        return null;
    }
  };

  const executionClasses = getExecutionClasses();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setShowContextMenu(false);
      }
    };

    if (showContextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showContextMenu]);

  const duplicateTask = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${task.title} ${tc('copySuffix')}`,
          status: task.status,
          priority: task.priority,
          themeId: task.themeId,
          description: task.description,
          estimatedHours: task.estimatedHours,
        }),
      });

      if (!res.ok) throw new Error(tHome('duplicateFailed'));
      showToast(tHome('duplicated'), 'success');
      onTaskUpdated?.();
      setShowContextMenu(false);
    } catch (e) {
      logger.error(e);
      showToast(tHome('duplicateFailed'), 'error');
    }
  };

  const deleteTask = async () => {
    if (!confirm(tHome('deleteConfirm'))) return;

    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${task.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error(tHome('deleteFailed'));
      showToast(tHome('taskDeleted'), 'success');
      onTaskUpdated?.();
      setShowContextMenu(false);
    } catch (e) {
      logger.error(e);
      showToast(tHome('deleteFailed'), 'error');
    }
  };

  // Prefetch on hover
  const handleMouseEnter = async () => {
    if (!prefetchedRef.current) {
      prefetchedRef.current = true;
      // Prefetch task details (24h cache)
      await prefetch([`/tasks/${task.id}`], 24 * 60 * 60 * 1000);

      // Prefetch related data when subtasks exist
      if (task.subtasks && task.subtasks.length > 0) {
        const subtaskPaths = task.subtasks.map((s) => `/tasks/${s.id}`);
        await prefetch(subtaskPaths, 24 * 60 * 60 * 1000);
      }
    }
  };

  const sweepColors = useProgressColors(1, 2);

  const [cardSize, setCardSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!cardRef.current) return;
    const { width, height } = cardRef.current.getBoundingClientRect();
    setCardSize({ w: width, h: height });
  }, []);

  // Calculate circumference for progress ring
  const _perimeter =
    cardSize.w > 0 ? Math.round(2 * (cardSize.w + cardSize.h)) : 0;

  // Amber style for waiting_for_input state
  const isWaitingForInput = executionStatus === 'waiting_for_input';
  const waitingAmberConfig = {
    color: 'text-amber-700 dark:text-amber-300',
    bgColor: 'bg-amber-50 dark:bg-amber-900/40',
    borderColor: 'border-l-amber-500 dark:border-l-amber-400',
    label: t('waitingForInput'),
  };

  // Left border color (amber for waiting_for_input)
  const cardBorderColor = isWaitingForInput
    ? waitingAmberConfig.borderColor
    : currentStatus.borderColor;

  return (
    <div
      ref={cardRef}
      data-task-card
      onMouseEnter={handleMouseEnter}
      className={`group relative z-0 rounded-lg border-l-4 border-t border-r border-b transition-all duration-300 ease-out hover:duration-200 ${
        isSelected
          ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-400 dark:border-purple-600 shadow-lg shadow-purple-200/50 dark:shadow-purple-900/50'
          : `${cardBorderColor} border-zinc-200 dark:border-zinc-800 ${currentStatus.bgColor} dark:bg-indigo-dark-900`
      } ${
        !isSelected
          ? 'hover:shadow-xl hover:scale-[1.02] hover:-translate-y-0.5 hover:border-opacity-80 dark:hover:shadow-2xl dark:hover:shadow-black/30'
          : ''
      } ${
        executionClasses?.borderColor === 'blue'
          ? 'ai-glow-blue'
          : executionClasses?.borderColor === 'amber'
            ? 'ai-glow-amber'
            : ''
      }`}
    >
      <CardLightSweep
        active={sweepingTaskId === task.id}
        colors={sweepColors}
      />

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
            setContextMenuPosition({ x: e.clientX, y: e.clientY });
            setShowContextMenu(true);
          }
        }}
      >
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
              isWaitingForInput ? waitingAmberConfig.color : currentStatus.color
            } ${
              isWaitingForInput
                ? waitingAmberConfig.bgColor
                : currentStatus.bgColor
            } ${
              executionStatus
                ? ''
                : `border-2 ${(isWaitingForInput
                    ? waitingAmberConfig.borderColor
                    : currentStatus.borderColor
                  ).replace('border-l-', 'border-')}`
            } shrink-0`}
            aria-label={
              isWaitingForInput ? waitingAmberConfig.label : currentStatus.label
            }
          >
            {(executionStatus === 'running' ||
              executionStatus === 'waiting_for_input') && (
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
                    executionStatus === 'waiting_for_input'
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
            {renderStatusIcon(isWaitingForInput ? 'in-progress' : task.status)}
          </div>
        )}

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

              {executionClasses && (
                <div
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium shrink-0 ${executionClasses.badgeClass}`}
                  title={executionClasses.label}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full execution-dot-pulse ${executionClasses.dotClass}`}
                    aria-hidden="true"
                  />
                  <span>{executionClasses.label}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            {localSubtasks.length > 0 && (
              <>
                <div className="shrink-0 flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedSubtasks(!expandedSubtasks);
                    }}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium flex items-center gap-1 transition-all duration-200 ease-out hover:scale-105"
                    aria-expanded={expandedSubtasks}
                    aria-label={t('subtasks')}
                  >
                    <svg
                      className={`w-3 h-3 transition-transform duration-300 ease-out ${
                        expandedSubtasks ? 'rotate-90' : ''
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
                    {localSubtasks.filter((s) => s.status === 'done').length}/
                    {localSubtasks.length}
                  </button>
                  {completionRate !== null && (
                    <div className="w-75 h-1 ml-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${getProgressBarColor(completionRate)} transition-all duration-700 ease-out`}
                        style={{ width: `${completionRate}%` }}
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

        {!isSelectionMode && (
          <div
            className="flex items-center gap-1 pl-3 self-stretch"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            {['todo', 'in-progress', 'done'].map((status) => {
              // Amber color for in-progress button when waiting_for_input
              const baseConfig =
                statusConfig[status as keyof typeof statusConfig];
              const config =
                isWaitingForInput && status === 'in-progress'
                  ? { ...baseConfig, ...waitingAmberConfig }
                  : baseConfig;
              return (
                <TaskStatusChange
                  key={status}
                  status={status}
                  currentStatus={task.status}
                  config={config}
                  renderIcon={renderStatusIcon}
                  onClick={(status: string) =>
                    onStatusChange(
                      task.id,
                      status as Status,
                      cardRef.current || undefined,
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

      {showContextMenu && (
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label={tc('edit')}
          className="fixed z-50 bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 py-1 min-w-40 animate-in fade-in duration-100"
          style={{
            left: `${contextMenuPosition.x}px`,
            top: `${contextMenuPosition.y}px`,
          }}
        >
          <button
            role="menuitem"
            onClick={() => {
              onTaskClick(task.id);
              setShowContextMenu(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-mono text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Edit className="w-4 h-4" aria-hidden="true" />
            {tc('edit')}
          </button>
          <button
            role="menuitem"
            onClick={duplicateTask}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-mono text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Copy className="w-4 h-4" aria-hidden="true" />
            {tHome('duplicate')}
          </button>
          <div
            role="separator"
            className="my-1 border-t border-slate-200 dark:border-slate-700"
          />
          <button
            role="menuitem"
            onClick={deleteTask}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-mono text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            {tc('delete')}
          </button>
        </div>
      )}

      {expandedSubtasks && localSubtasks.length > 0 && (
        <div
          className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-indigo-dark-900/50 p-3"
          onClick={(e) => e.stopPropagation()}
        >
          {localSubtasks.map((subtask, index) => {
            const subtaskStatus =
              statusConfig[subtask.status as keyof typeof statusConfig] ||
              statusConfig.todo;
            const isFirst = index === 0;
            const isLast = index === localSubtasks.length - 1;
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
                  } ${
                    subtaskStatus.bgColor
                  } border ${subtaskStatus.borderColor.replace(
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
                  onStatusChange={handleSubtaskStatusChange}
                  size="sm"
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default TaskCard;
