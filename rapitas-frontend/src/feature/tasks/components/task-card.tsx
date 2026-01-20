"use client";
import { useState } from "react";
import type { Task } from "@/types";
import { priorityColors, priorityLabels, Status } from "@/types";
import TaskStatusChange from "@/feature/tasks/components/task-status-change";
import SubtaskStatusButtons from "@/feature/tasks/components/subtask-status-buttons";
import {
  statusConfig,
  renderStatusIcon,
} from "@/feature/tasks/config/status-config";

interface TaskCardProps {
  task: Task;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onTaskClick: (taskId: number) => void;
  onStatusChange: (taskId: number, status: Status) => void;
  onToggleSelect?: (taskId: number) => void;
  onTaskUpdated?: () => void;
}

export default function TaskCard({
  task,
  isSelected = false,
  isSelectionMode = false,
  onTaskClick,
  onStatusChange,
  onToggleSelect,
  onTaskUpdated,
}: TaskCardProps) {
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [expandedSubtasks, setExpandedSubtasks] = useState(false);

  const currentStatus =
    statusConfig[task.status as keyof typeof statusConfig] || statusConfig.todo;
  const completionRate = task.subtasks?.length
    ? Math.round(
        (task.subtasks.filter((s) => s.status === "done").length /
          task.subtasks.length) *
          100,
      )
    : null;

  const getProgressBarColor = (rate: number) => {
    if (rate === 100) return "bg-green-500";
    if (rate >= 80) return "bg-gradient-to-r from-blue-500 to-green-500";
    if (rate >= 50) return "bg-blue-500";
    return "bg-gradient-to-r from-blue-500 to-orange-500";
  };

  return (
    <div
      className={`group relative rounded-lg border-l-4 border-t border-r border-b transition-all duration-150 ${
        currentStatus.borderColor
      } ${`border-zinc-200 dark:border-zinc-800 ${currentStatus.bgColor} hover:shadow-sm`}`}
      onMouseEnter={() => !isSelectionMode && setShowQuickActions(true)}
      onMouseLeave={() => setShowQuickActions(false)}
    >
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
        onClick={() => {
          if (isSelectionMode && onToggleSelect) {
            onToggleSelect(task.id);
          } else {
            onTaskClick(task.id);
          }
        }}
      >
        {/* 左: チェックボックス/ステータス */}
        {isSelectionMode ? (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect?.(task.id)}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 text-purple-600 focus:ring-purple-500 cursor-pointer"
          />
        ) : (
          <div
            className={`flex items-center justify-center w-7 h-7 rounded-md ${
              currentStatus.color
            } ${
              currentStatus.bgColor
            } border-2 ${currentStatus.borderColor.replace(
              "border-l-",
              "border-",
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
            {task.priority && task.priority !== "medium" && (
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                  priorityColors[task.priority]
                } shrink-0`}
              >
                {priorityLabels[task.priority]}
              </span>
            )}
          </div>

          {/* メタ情報 */}
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            {/* 作成日 */}
            <span className="shrink-0">
              {new Date(task.createdAt).toLocaleDateString("ja-JP", {
                month: "numeric",
                day: "numeric",
              })}
            </span>

            {task.project && (
              <>
                <span className="text-zinc-300 dark:text-zinc-700">•</span>
                <span
                  className="shrink-0 font-medium"
                  style={{ color: task.project.color }}
                >
                  {task.project.icon} {task.project.name}
                </span>
              </>
            )}

            {task.milestone && (
              <>
                <span className="text-zinc-300 dark:text-zinc-700">•</span>
                <span className="shrink-0 text-purple-600 dark:text-purple-400">
                  🎯 {task.milestone.name}
                </span>
              </>
            )}

            {task.subtasks && task.subtasks.length > 0 && (
              <>
                <span className="text-zinc-300 dark:text-zinc-700">•</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedSubtasks(!expandedSubtasks);
                  }}
                  className="shrink-0 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium flex items-center gap-1"
                >
                  <svg
                    className={`w-3 h-3 transition-transform ${
                      expandedSubtasks ? "rotate-90" : ""
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
                  {task.subtasks.filter((s) => s.status === "done").length}/
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

            {task.labels && task.labels.length > 0 && (
              <>
                <span className="text-zinc-300 dark:text-zinc-700">•</span>
                <span className="shrink-0">🏷 {task.labels.length}</span>
              </>
            )}
          </div>

          {/* プログレスバー */}
          {task.subtasks &&
            task.subtasks.length > 0 &&
            completionRate !== null && (
              <div className="mt-1.5 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className={`h-full ${getProgressBarColor(
                    completionRate,
                  )} transition-all duration-300`}
                  style={{ width: `${completionRate}%` }}
                />
              </div>
            )}
        </div>

        {/* 右: クイックアクション */}
        <div
          className={`flex items-center gap-1 transition-opacity duration-150 ${
            showQuickActions
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <>
            {/* ステータス変更ボタン */}
            {["todo", "in-progress", "done"].map((status) => {
              const config = statusConfig[status as keyof typeof statusConfig];
              return (
                <TaskStatusChange
                  key={status}
                  status={status}
                  currentStatus={task.status}
                  config={config}
                  renderIcon={renderStatusIcon}
                  onClick={(status: string) =>
                    onStatusChange(task.id, status as Status)
                  }
                  size="md"
                />
              );
            })}
          </>
        </div>
      </div>

      {/* サブタスク展開エリア */}
      {expandedSubtasks && task.subtasks && task.subtasks.length > 0 && (
        <div
          className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 p-3"
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
                ? "rounded-md"
                : isFirst
                  ? "rounded-t-md"
                  : isLast
                    ? "rounded-b-md"
                    : "";
            return (
              <div
                key={subtask.id}
                className={`flex items-center gap-2 p-2 ${roundedClass} transition-colors border-l-2 ${subtaskStatus.borderColor} ${subtaskStatus.bgColor}`}
              >
                <div
                  className={`flex items-center justify-center w-6 h-6 rounded ${
                    subtaskStatus.color
                  } ${
                    subtaskStatus.bgColor
                  } border ${subtaskStatus.borderColor.replace(
                    "border-l-",
                    "border-",
                  )} shrink-0`}
                  title={subtaskStatus.label}
                >
                  {renderStatusIcon(subtask.status)}
                </div>
                <span
                  className={`flex-1 text-sm ${
                    subtask.status === "done"
                      ? "line-through text-zinc-500 dark:text-zinc-500"
                      : "text-zinc-700 dark:text-zinc-300"
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
}
