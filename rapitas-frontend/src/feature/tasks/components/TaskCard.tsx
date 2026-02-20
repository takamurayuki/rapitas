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
import { ExternalLink, Tag, Copy, Trash2, Edit } from 'lucide-react';
import { getLabelsArray, hasLabels } from '@/utils/labels';
import { getIconComponent } from '@/components/category/IconData';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { API_BASE_URL } from '@/utils/api';
import { CardLightSweep, useProgressColors } from './TaskCompletionAnimation';
import { prefetch } from '@/lib/api-client';

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

  const currentStatus =
    statusConfig[task.status as keyof typeof statusConfig] || statusConfig.todo;
  const completionRate = task.subtasks?.length
    ? Math.round(
        (task.subtasks.filter((s) => s.status === 'done').length /
          task.subtasks.length) *
          100,
      )
    : null;

  const getProgressBarColor = (rate: number) => {
    if (rate === 100) return 'bg-green-500';
    if (rate >= 80) return 'bg-gradient-to-r from-blue-500 to-green-500';
    if (rate >= 50) return 'bg-blue-500';
    return 'bg-gradient-to-r from-blue-500 to-orange-500';
  };

  // コンテキストメニューを閉じる
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

  // タスクを複製
  const duplicateTask = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${task.title} (コピー)`,
          status: task.status,
          priority: task.priority,
          themeId: task.themeId,
          description: task.description,
          estimatedHours: task.estimatedHours,
        }),
      });

      if (!res.ok) throw new Error('複製に失敗しました');
      showToast('タスクを複製しました', 'success');
      onTaskUpdated?.();
      setShowContextMenu(false);
    } catch (e) {
      console.error(e);
      showToast('タスクの複製に失敗しました', 'error');
    }
  };

  // タスクを削除
  const deleteTask = async () => {
    if (!confirm('このタスクを削除しますか？')) return;

    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${task.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('削除に失敗しました');
      showToast('タスクを削除しました', 'success');
      onTaskUpdated?.();
      setShowContextMenu(false);
    } catch (e) {
      console.error(e);
      showToast('タスクの削除に失敗しました', 'error');
    }
  };

  // ホバー時のプリフェッチ処理
  const handleMouseEnter = async () => {
    if (!prefetchedRef.current) {
      prefetchedRef.current = true;
      // タスク詳細をプリフェッチ（24時間キャッシュ）
      await prefetch([`/tasks/${task.id}`], 24 * 60 * 60 * 1000);

      // サブタスクがある場合は関連データもプリフェッチ
      if (task.subtasks && task.subtasks.length > 0) {
        const subtaskPaths = task.subtasks.map((s) => `/tasks/${s.id}`);
        await prefetch(subtaskPaths, 24 * 60 * 60 * 1000); // 24時間キャッシュ
      }
    }
  };

  // ライトスイープ用のカラー設定（仮の値）
  const sweepColors = useProgressColors(1, 2);

  return (
    <div
      ref={cardRef}
      data-task-card
      onMouseEnter={handleMouseEnter}
      className={`group relative rounded-lg border-l-4 border-t border-r border-b transition-all duration-300 ease-out hover:duration-200 ${
        isSelected
          ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-400 dark:border-purple-600 shadow-lg shadow-purple-200/50 dark:shadow-purple-900/50'
          : `${currentStatus.borderColor} border-zinc-200 dark:border-zinc-800 ${currentStatus.bgColor} dark:bg-indigo-dark-900`
      } ${
        !isSelected ? 'hover:shadow-xl hover:scale-[1.02] hover:-translate-y-0.5 hover:border-opacity-80 dark:hover:shadow-2xl dark:hover:shadow-black/30' : ''
      }`}
    >
      {/* カードライトスイープエフェクト */}
      <CardLightSweep
        active={sweepingTaskId === task.id}
        colors={sweepColors}
      />
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-all duration-300 ease-out hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 rounded-t-lg"
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
        {/* 左: チェックボックス/ステータス */}
        {isSelectionMode ? (
          <div className="relative">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect?.(task.id)}
              onClick={(e) => e.stopPropagation()}
              className="w-5 h-5 rounded-md border-2 border-slate-300 dark:border-slate-600 text-purple-600 dark:text-purple-500 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-purple-500 dark:focus:ring-purple-400 focus:ring-offset-0 cursor-pointer transition-all duration-200 hover:border-purple-500 dark:hover:border-purple-400 hover:shadow-md checked:bg-purple-600 checked:border-purple-600 dark:checked:bg-purple-500 dark:checked:border-purple-500 checked:hover:bg-purple-700 dark:checked:hover:bg-purple-600"
              style={{
                backgroundImage: isSelected ? 'none' : undefined,
                backgroundColor: isSelected ? 'rgb(147 51 234)' : undefined,
              }}
            />
            {isSelected && (
              <svg
                className="absolute top-1 left-1 w-3 h-3 text-white pointer-events-none"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
        ) : (
          <div
            className={`flex items-center justify-center w-7 h-7 rounded-md ${
              currentStatus.color
            } ${
              currentStatus.bgColor
            } border-2 ${currentStatus.borderColor.replace(
              'border-l-',
              'border-',
            )} shrink-0`}
            title={currentStatus.label}
          >
            {renderStatusIcon(task.status)}
          </div>
        )}

        {/* 中央: タスク情報 */}
        <div className="flex-1 min-w-0">
          {/* タイトル行 */}
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50 truncate text-sm">
              {task.title}
            </h3>
            {/* 優先度アイコン */}
            <PriorityIcon priority={task.priority} size="md" />
          </div>

          {/* メタ情報 */}
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            {/* 作成日 */}
            <span className="shrink-0">
              {new Date(task.createdAt).toLocaleDateString('ja-JP', {
                month: 'numeric',
                day: 'numeric',
              })}
            </span>

            {task.subtasks && task.subtasks.length > 0 && (
              <>
                <span className="text-zinc-300 dark:text-zinc-700">•</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedSubtasks(!expandedSubtasks);
                  }}
                  className="shrink-0 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium flex items-center gap-1 transition-all duration-200 ease-out hover:scale-105"
                >
                  <svg
                    className={`w-3 h-3 transition-transform duration-300 ease-out ${
                      expandedSubtasks ? 'rotate-90' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                  {task.subtasks.filter((s) => s.status === 'done').length}/
                  {task.subtasks.length}
                </button>
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

          {/* プログレスバー */}
          {task.subtasks &&
            task.subtasks.length > 0 &&
            completionRate !== null && (
              <div className="mt-1.5 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className={`h-full ${getProgressBarColor(
                    completionRate,
                  )} transition-all duration-700 ease-out`}
                  style={{ width: `${completionRate}%` }}
                />
              </div>
            )}
        </div>

        {/* 右: クイックアクション（常に表示） */}
        {!isSelectionMode && (
          <div
            className="flex items-center gap-1 pl-3 self-stretch"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            {/* ステータス変更ボタン */}
            {['todo', 'in-progress', 'done'].map((status) => {
              const config = statusConfig[status as keyof typeof statusConfig];
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
            {/* ページで開くボタン */}
            {onOpenInPage && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenInPage(task.id);
                }}
                className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-all duration-200 ease-out hover:scale-110"
                title="ページで開く"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* コンテキストメニュー */}
      {showContextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 py-1 min-w-40 animate-in fade-in duration-100"
          style={{
            left: `${contextMenuPosition.x}px`,
            top: `${contextMenuPosition.y}px`,
          }}
        >
          <button
            onClick={() => {
              onTaskClick(task.id);
              setShowContextMenu(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-mono text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Edit className="w-4 h-4" />
            編集
          </button>
          <button
            onClick={duplicateTask}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-mono text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Copy className="w-4 h-4" />
            複製
          </button>
          <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
          <button
            onClick={deleteTask}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-mono text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            削除
          </button>
        </div>
      )}

      {/* サブタスク展開エリア */}
      {expandedSubtasks && task.subtasks && task.subtasks.length > 0 && (
        <div
          className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-indigo-dark-900/50 p-3"
          onClick={(e) => e.stopPropagation()}
        >
          {task.subtasks.map((subtask, index) => {
            const subtaskStatus =
              statusConfig[subtask.status as keyof typeof statusConfig] ||
              statusConfig.todo;
            const isFirst = index === 0;
            const isLast = index === task.subtasks!.length - 1;
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
                  title={subtaskStatus.label}
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

                {/* サブタスクステータス変更ボタン */}
                <SubtaskStatusButtons
                  taskId={subtask.id}
                  currentStatus={subtask.status}
                  onTaskUpdated={onTaskUpdated}
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
