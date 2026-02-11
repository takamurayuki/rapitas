"use client";
import { useCallback, useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
  type DroppableProvided,
  type DroppableStateSnapshot,
  type DraggableProvided,
  type DraggableStateSnapshot,
} from "@hello-pangea/dnd";
import TaskSlidePanel from "@/feature/tasks/components/TaskSlidePanel";
import { getLabelsArray, hasLabels } from "@/utils/labels";
import { useTaskDetailVisibilityStore } from "@/stores/taskDetailVisibilityStore";
import { getTaskDetailPath } from "@/utils/tauri";
import { API_BASE_URL } from "@/utils/api";
import { useExecutingTasksPolling } from "@/hooks/useExecutingTasksPolling";
import { useTaskCacheStore } from "@/stores/taskCacheStore";
import { ExternalLink, Search, Filter, X, Flag, Tag } from "lucide-react";
import type { Label } from "@/types";

type Priority = "low" | "medium" | "high" | "urgent";

const priorityConfig: Record<
  Priority,
  { label: string; color: string; bg: string }
> = {
  low: {
    label: "低",
    color: "text-slate-600",
    bg: "bg-slate-100 dark:bg-slate-800",
  },
  medium: {
    label: "中",
    color: "text-blue-600",
    bg: "bg-blue-100 dark:bg-blue-900",
  },
  high: {
    label: "高",
    color: "text-amber-600",
    bg: "bg-amber-100 dark:bg-amber-900",
  },
  urgent: {
    label: "緊急",
    color: "text-rose-600",
    bg: "bg-rose-100 dark:bg-rose-900",
  },
};

const API_BASE = API_BASE_URL;

const columns = [
  { id: "todo", label: "未着手", color: "bg-gray-100 dark:bg-gray-800" },
  { id: "in-progress", label: "進行中", color: "bg-blue-100 dark:bg-blue-900" },
  { id: "done", label: "完了", color: "bg-green-100 dark:bg-green-900" },
];

export default function KanbanPage() {
  const router = useRouter();
  const tasks = useTaskCacheStore((s) => s.tasks);
  const taskCacheInitialized = useTaskCacheStore((s) => s.initialized);
  const taskCacheLoading = useTaskCacheStore((s) => s.loading);
  const fetchAllTasks = useTaskCacheStore((s) => s.fetchAll);
  const fetchTaskUpdates = useTaskCacheStore((s) => s.fetchUpdates);
  const updateTaskLocally = useTaskCacheStore((s) => s.updateTaskLocally);
  const [loading, setLoading] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const { showTaskDetail, hideTaskDetail } = useTaskDetailVisibilityStore();

  // フィルター状態
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPriorities, setSelectedPriorities] = useState<Priority[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<number[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [labels, setLabels] = useState<Label[]>([]);

  // フィルタリングされたタスク
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // 検索フィルター
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = task.title.toLowerCase().includes(query);
        const matchesDescription = task.description
          ?.toLowerCase()
          .includes(query);
        if (!matchesTitle && !matchesDescription) return false;
      }

      // 優先度フィルター
      if (selectedPriorities.length > 0) {
        if (!task.priority || !selectedPriorities.includes(task.priority))
          return false;
      }

      // ラベルフィルター
      if (selectedLabelIds.length > 0) {
        const taskLabelIds = task.taskLabels?.map((tl) => tl.label?.id).filter((id): id is number => id != null) || [];
        const hasMatchingLabel = selectedLabelIds.some((id) =>
          taskLabelIds.includes(id),
        );
        if (!hasMatchingLabel) return false;
      }

      return true;
    });
  }, [tasks, searchQuery, selectedPriorities, selectedLabelIds]);

  const hasActiveFilters =
    searchQuery || selectedPriorities.length > 0 || selectedLabelIds.length > 0;

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedPriorities([]);
    setSelectedLabelIds([]);
  };

  const togglePriority = (priority: Priority) => {
    setSelectedPriorities((prev) =>
      prev.includes(priority)
        ? prev.filter((p) => p !== priority)
        : [...prev, priority],
    );
  };

  const toggleLabel = (labelId: number) => {
    setSelectedLabelIds((prev) =>
      prev.includes(labelId)
        ? prev.filter((id) => id !== labelId)
        : [...prev, labelId],
    );
  };

  const fetchLabels = async () => {
    try {
      const res = await fetch(`${API_BASE}/labels`);
      if (res.ok) setLabels(await res.json());
    } catch (e) {
      console.error("Failed to fetch labels:", e);
    }
  };

  const fetchTasks = useCallback(async () => {
    if (taskCacheInitialized) {
      await fetchTaskUpdates();
    } else {
      setLoading(true);
      await fetchAllTasks();
      setLoading(false);
    }
  }, [taskCacheInitialized, fetchTaskUpdates, fetchAllTasks]);

  const updateStatus = async (id: number, status: string) => {
    const oldTask = tasks.find((t) => t.id === id);
    updateTaskLocally(id, { status: status as import("@/types").Status });

    try {
      const res = await fetch(`${API_BASE}/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("更新に失敗しました");
    } catch (e) {
      console.error(e);
      if (oldTask) {
        updateTaskLocally(id, { status: oldTask.status });
      }
    }
  };

  const onDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    )
      return;

    const taskId = parseInt(draggableId);
    const newStatus = destination.droppableId;

    updateStatus(taskId, newStatus);
  };

  const openTaskPanel = useCallback(
    (taskId: number) => {
      setSelectedTaskId(taskId);
      setIsPanelOpen(true);
      showTaskDetail();
    },
    [showTaskDetail],
  );

  const closeTaskPanel = useCallback(() => {
    setIsPanelOpen(false);
    hideTaskDetail();
    setTimeout(() => setSelectedTaskId(null), 300);
  }, [hideTaskDetail]);

  // 実行中タスクのポーリング: 実行中タスクが検出されたら自動的にパネルを開く
  // パネルが既に開いている場合は別タスクに切り替えない
  const handleExecutingTaskFound = useCallback(
    (taskId: number) => {
      if (!isPanelOpen) {
        openTaskPanel(taskId);
      }
    },
    [isPanelOpen, openTaskPanel],
  );

  useExecutingTasksPolling({
    interval: 5000,
    onExecutingTaskFound: handleExecutingTaskFound,
  });

  // タスクをページとして開く（ヘッダー表示モード）
  const openTaskInPage = (taskId: number) => {
    router.push(`/tasks/${taskId}?showHeader=true`);
  };

  useEffect(() => {
    fetchTasks();
    fetchLabels();

    const handleFocus = () => {
      fetchTaskUpdates();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  const getTasksByStatus = (status: string) =>
    filteredTasks.filter((t) => t.status === status && !t.parentId);

  return (
    <div className="h-[calc(100vh-4.2rem)] overflow-auto bg-background scrollbar-thin">
      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Filter Bar */}
        <div className="mb-6 space-y-3">
          <div className="flex items-center gap-3">
            {/* Clear Filters */}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                クリア
              </button>
            )}
          </div>

          {/* Filter Options */}
          {showFilters && (
            <div className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 space-y-4">
              {/* Priority Filter */}
              <div>
                <div className="flex items-center gap-2 mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  <Flag className="w-4 h-4" />
                  優先度
                </div>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(priorityConfig) as Priority[]).map(
                    (priority) => {
                      const config = priorityConfig[priority];
                      const isSelected = selectedPriorities.includes(priority);
                      return (
                        <button
                          key={priority}
                          onClick={() => togglePriority(priority)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            isSelected
                              ? `${config.bg} ${config.color} ring-1 ring-current`
                              : "bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600"
                          }`}
                        >
                          {config.label}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>

              {/* Label Filter */}
              {labels.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    <Tag className="w-4 h-4" />
                    ラベル
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {labels.map((label) => {
                      const isSelected = selectedLabelIds.includes(label.id);
                      return (
                        <button
                          key={label.id}
                          onClick={() => toggleLabel(label.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            isSelected
                              ? "ring-1 ring-offset-1"
                              : "opacity-70 hover:opacity-100"
                          }`}
                          style={{
                            backgroundColor: isSelected
                              ? label.color
                              : `${label.color}20`,
                            color: isSelected ? "#fff" : label.color,
                            ["--tw-ring-color" as string]: label.color,
                          }}
                        >
                          {label.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Results count */}
          {hasActiveFilters && (
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              {filteredTasks.filter((t) => !t.parentId).length}
              件のタスクが見つかりました
            </div>
          )}
        </div>

        {(loading || taskCacheLoading) && tasks.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-3">
                <div className="h-5 w-24 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse" />
                {[1, 2].map((j) => (
                  <div key={j} className="h-20 bg-zinc-200 dark:bg-zinc-700 rounded-xl animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {columns.map((column) => (
                <div key={column.id} className="flex flex-col">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                      {column.label}
                    </h2>
                    <span className="rounded-full bg-zinc-200 dark:bg-zinc-700 px-2 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {getTasksByStatus(column.id).length}
                    </span>
                  </div>

                  <Droppable droppableId={column.id}>
                    {(
                      provided: DroppableProvided,
                      snapshot: DroppableStateSnapshot,
                    ) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`flex-1 rounded-lg p-3 transition-colors ${
                          snapshot.isDraggingOver
                            ? "bg-blue-50 dark:bg-blue-950"
                            : "bg-zinc-50 dark:bg-indigo-dark-900"
                        } min-h-[200px]`}
                      >
                        <div className="space-y-2">
                          {getTasksByStatus(column.id).map((task, index) => (
                            <Draggable
                              key={task.id}
                              draggableId={task.id.toString()}
                              index={index}
                            >
                              {(
                                provided: DraggableProvided,
                                snapshot: DraggableStateSnapshot,
                              ) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  onClick={() => openTaskPanel(task.id)}
                                  className={`rounded-lg border bg-white dark:bg-zinc-800 p-3 shadow-sm transition-all cursor-pointer ${
                                    snapshot.isDragging
                                      ? "shadow-lg border-blue-500"
                                      : "border-zinc-200 dark:border-zinc-700 hover:shadow-md hover:border-blue-400 dark:hover:border-blue-600"
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-2 mb-2">
                                    <h3 className="flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                                      {task.title}
                                    </h3>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openTaskInPage(task.id);
                                      }}
                                      className="text-zinc-500 hover:text-blue-600 dark:text-zinc-400 dark:hover:text-blue-400 transition-colors"
                                      title="ページで開く"
                                    >
                                      <ExternalLink className="w-4 h-4" />
                                    </button>
                                  </div>

                                  {/* メタ情報 */}
                                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                                    {/* 日付 */}
                                    <span className="flex items-center gap-1">
                                      <svg
                                        className="w-3 h-3"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth={2}
                                          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                                        />
                                      </svg>
                                      {new Date(
                                        task.createdAt,
                                      ).toLocaleDateString("ja-JP")}
                                    </span>

                                    {/* サブタスク */}
                                    {task.subtasks &&
                                      task.subtasks.length > 0 && (
                                        <span className="flex items-center gap-1">
                                          <svg
                                            className="w-3 h-3"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                          >
                                            <path
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              strokeWidth={2}
                                              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                                            />
                                          </svg>
                                          {
                                            task.subtasks.filter(
                                              (st) => st.status === "done",
                                            ).length
                                          }
                                          /{task.subtasks.length}
                                        </span>
                                      )}

                                    {/* ラベル数 */}
                                    {hasLabels(task.labels) && (
                                      <span className="flex items-center gap-1">
                                        <svg
                                          className="w-3 h-3"
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                                          />
                                        </svg>
                                        {getLabelsArray(task.labels).length}
                                      </span>
                                    )}

                                    {/* 見積もり時間 */}
                                    {task.estimatedHours && (
                                      <span className="flex items-center gap-1">
                                        <svg
                                          className="w-3 h-3"
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                          />
                                        </svg>
                                        {task.estimatedHours}h
                                      </span>
                                    )}
                                  </div>

                                  {/* ラベル表示 */}
                                  {hasLabels(task.labels) && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {getLabelsArray(task.labels)
                                        .slice(0, 3)
                                        .map((label, idx) => (
                                          <span
                                            key={idx}
                                            className="rounded-full bg-blue-100 dark:bg-blue-900 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300"
                                          >
                                            {label}
                                          </span>
                                        ))}
                                      {getLabelsArray(task.labels).length >
                                        3 && (
                                        <span className="text-xs text-zinc-500">
                                          +
                                          {getLabelsArray(task.labels).length -
                                            3}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </Draggable>
                          ))}
                        </div>
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              ))}
            </div>
          </DragDropContext>
        )}
      </div>

      {/* タスク詳細スライドパネル */}
      <TaskSlidePanel
        taskId={selectedTaskId}
        isOpen={isPanelOpen}
        onClose={closeTaskPanel}
        onTaskUpdated={fetchTasks}
      />
    </div>
  );
}
