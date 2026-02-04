import { useState } from "react";
import { Task } from "@/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getLabelsArray, hasLabels } from "@/utils/labels";
import TaskStatusChange from "@/feature/tasks/components/TaskStatusChange";
import PriorityIcon from "@/feature/tasks/components/PriorityIcon";
import {
  statusConfig,
  renderStatusIcon,
} from "@/feature/tasks/config/StatusConfig";
import { Pencil, Check, X, Bot, Loader2 } from "lucide-react";
import {
  SubtaskTitleIndicator,
  type ParallelExecutionStatus,
} from "./SubtaskExecutionStatus";

interface SubtaskListProps {
  subtasks?: Task[];
  isAddingSubtask: boolean;
  subtaskTitle: string;
  subtaskDescription: string;
  subtaskLabels: string;
  subtaskEstimatedHours: string;
  onStatusUpdate: (taskId: number, newStatus: string) => void;
  onDeleteSubtask: (subtaskId: number) => void;
  onStartAddingSubtask: () => void;
  onSubtaskTitleChange: (value: string) => void;
  onSubtaskDescriptionChange: (value: string) => void;
  onSubtaskLabelsChange: (value: string) => void;
  onSubtaskEstimatedHoursChange: (value: string) => void;
  onAddSubtask: () => void;
  onCancelAddingSubtask: () => void;
  onUpdateSubtask?: (subtaskId: number, data: { title?: string; description?: string }) => void;
  /** 並列実行ステータスを取得する関数（サブタスクIDを渡すとステータスを返す） */
  getExecutionStatus?: (subtaskId: number) => ParallelExecutionStatus | undefined;
  /** 並列実行中かどうか */
  isParallelExecutionRunning?: boolean;
}

export default function SubtaskList({
  subtasks = [],
  isAddingSubtask,
  subtaskTitle,
  subtaskDescription,
  subtaskLabels,
  subtaskEstimatedHours,
  onStatusUpdate,
  onDeleteSubtask,
  onStartAddingSubtask,
  onSubtaskTitleChange,
  onSubtaskDescriptionChange,
  onSubtaskLabelsChange,
  onSubtaskEstimatedHoursChange,
  onAddSubtask,
  onCancelAddingSubtask,
  onUpdateSubtask,
  getExecutionStatus,
  isParallelExecutionRunning = false,
}: SubtaskListProps) {
  const [editingSubtaskId, setEditingSubtaskId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState("");

  const completedSubtasks = subtasks.filter((s) => s.status === "done") || [];
  const activeSubtasks = subtasks.filter((s) => s.status !== "done") || [];
  const totalSubtasks = subtasks.length || 0;
  const progressPercentage =
    totalSubtasks > 0
      ? Math.round((completedSubtasks.length / totalSubtasks) * 100)
      : 0;

  const startEditingSubtask = (subtask: Task) => {
    setEditingSubtaskId(subtask.id);
    setEditingTitle(subtask.title);
    setEditingDescription(subtask.description || "");
  };

  const cancelEditingSubtask = () => {
    setEditingSubtaskId(null);
    setEditingTitle("");
    setEditingDescription("");
  };

  const saveSubtaskEdit = () => {
    if (editingSubtaskId && editingTitle.trim() && onUpdateSubtask) {
      onUpdateSubtask(editingSubtaskId, {
        title: editingTitle,
        description: editingDescription || undefined,
      });
      cancelEditingSubtask();
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 p-8">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            サブタスク
            {totalSubtasks > 0 && (
              <span className="ml-3 text-base font-normal text-zinc-500">
                {completedSubtasks.length}/{totalSubtasks}件完了
              </span>
            )}
          </h2>
        </div>

        {/* 進行状況バー */}
        {totalSubtasks > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400 mb-2">
              <span>進捗状況</span>
              <span className="font-medium">{progressPercentage}%</span>
            </div>
            <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all duration-300"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* アクティブなサブタスク */}
      {activeSubtasks.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
            進行中・未着手
          </h3>
          <div className="space-y-3">
            {activeSubtasks.map((subtask) => (
              <div
                key={subtask.id}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-4"
              >
                {editingSubtaskId === subtask.id ? (
                  /* 編集モード */
                  <div className="space-y-3">
                    <input
                      type="text"
                      className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      placeholder="サブタスクタイトル"
                      autoFocus
                    />
                    <textarea
                      className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                      value={editingDescription}
                      onChange={(e) => setEditingDescription(e.target.value)}
                      placeholder="説明（マークダウン対応）"
                      rows={3}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={saveSubtaskEdit}
                        disabled={!editingTitle.trim()}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                      >
                        <Check className="w-4 h-4" />
                        保存
                      </button>
                      <button
                        onClick={cancelEditingSubtask}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                      >
                        <X className="w-4 h-4" />
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : (
                  /* 表示モード */
                  <>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {/* 並列実行ステータスインジケーター */}
                          {isParallelExecutionRunning && getExecutionStatus && (
                            <SubtaskTitleIndicator
                              executionStatus={getExecutionStatus(subtask.id)}
                              size="md"
                            />
                          )}
                          <h4 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
                            {subtask.title}
                          </h4>
                          <PriorityIcon priority={subtask.priority} size="md" />
                          {subtask.agentGenerated && (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded">
                              <Bot className="w-3 h-3" />
                              AI
                            </span>
                          )}
                        </div>
                        {subtask.description && (
                          <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none mt-2">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {subtask.description}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 ml-4 shrink-0">
                        {/* ステータス変更ボタン（コンパクト版） */}
                        {(["todo", "in-progress", "done"] as const).map((status) => {
                          const config = statusConfig[status];
                          return (
                            <TaskStatusChange
                              key={status}
                              status={status}
                              currentStatus={subtask.status}
                              config={config}
                              renderIcon={renderStatusIcon}
                              onClick={(newStatus) => onStatusUpdate(subtask.id, newStatus)}
                              size="sm"
                            />
                          );
                        })}
                        {/* 編集ボタン */}
                        {onUpdateSubtask && (
                          <button
                            onClick={() => startEditingSubtask(subtask)}
                            className="w-6 h-6 rounded flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                            title="編集"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {/* 削除ボタン */}
                        <button
                          onClick={() => onDeleteSubtask(subtask.id)}
                          className="w-6 h-6 rounded flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                          title="削除"
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {hasLabels(subtask.labels) && (
                        <div className="flex gap-1">
                          {getLabelsArray(subtask.labels).map((label, idx) => (
                            <span
                              key={idx}
                              className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                      {subtask.estimatedHours && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                          ⏱ {subtask.estimatedHours}h
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 完了したサブタスク */}
      {completedSubtasks.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3 flex items-center gap-2">
            <svg
              className="w-5 h-5 text-green-600 dark:text-green-400"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            完了 ({completedSubtasks.length}件)
          </h3>
          <div className="space-y-2">
            {completedSubtasks.map((subtask) => (
              <div
                key={subtask.id}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3 opacity-60"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1">
                    {/* 並列実行ステータスインジケーター（完了タスクでも表示） */}
                    {isParallelExecutionRunning && getExecutionStatus && (
                      <SubtaskTitleIndicator
                        executionStatus={getExecutionStatus(subtask.id)}
                        size="sm"
                      />
                    )}
                    <h4 className="text-base font-medium text-zinc-900 dark:text-zinc-50 line-through">
                      {subtask.title}
                    </h4>
                    <PriorityIcon priority={subtask.priority} size="sm" />
                    {subtask.agentGenerated && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded">
                        <Bot className="w-3 h-3" />
                        AI
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-4">
                    {/* ステータス変更ボタン（コンパクト版） */}
                    {(["todo", "in-progress", "done"] as const).map((status) => {
                      const config = statusConfig[status];
                      return (
                        <TaskStatusChange
                          key={status}
                          status={status}
                          currentStatus={subtask.status}
                          config={config}
                          renderIcon={renderStatusIcon}
                          onClick={(newStatus) => onStatusUpdate(subtask.id, newStatus)}
                          size="sm"
                        />
                      );
                    })}
                    {/* 編集ボタン */}
                    {onUpdateSubtask && (
                      <button
                        onClick={() => startEditingSubtask(subtask)}
                        className="w-6 h-6 rounded flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                        title="編集"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {/* 削除ボタン */}
                    <button
                      onClick={() => onDeleteSubtask(subtask.id)}
                      className="w-6 h-6 rounded flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                      title="削除"
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* サブタスク追加フォーム */}
      <div className={totalSubtasks > 0 ? "mt-6" : ""}>
        {isAddingSubtask ? (
          <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-white dark:bg-zinc-900 mb-4">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-3">
              新しいサブタスク
            </h3>
            <div className="space-y-3">
              <div>
                <input
                  type="text"
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="サブタスクタイトル *"
                  value={subtaskTitle}
                  onChange={(e) => onSubtaskTitleChange(e.target.value)}
                  autoFocus
                />
              </div>

              <div>
                <textarea
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  placeholder="説明（マークダウン対応）&#10;- [ ] チェックリスト&#10;`コード` **太字**"
                  value={subtaskDescription}
                  onChange={(e) => onSubtaskDescriptionChange(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="ラベル（カンマ区切り）"
                  value={subtaskLabels}
                  onChange={(e) => onSubtaskLabelsChange(e.target.value)}
                />
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="見積もり時間（h）"
                  value={subtaskEstimatedHours}
                  onChange={(e) => onSubtaskEstimatedHoursChange(e.target.value)}
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onAddSubtask}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                  disabled={!subtaskTitle.trim()}
                >
                  追加
                </button>
                <button
                  type="button"
                  onClick={onCancelAddingSubtask}
                  className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onStartAddingSubtask}
            className="w-full rounded-lg border-2 border-dashed border-zinc-300 dark:border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            + サブタスクを追加
          </button>
        )}
      </div>
    </div>
  );
}
