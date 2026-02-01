"use client";
import { useEffect, useState } from "react";
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

type Task = {
  id: number;
  title: string;
  description?: string | null;
  status: string;
  labels?: string[];
  estimatedHours?: number | null;
  parentId?: number | null;
  subtasks?: Task[];
  createdAt: string;
  updatedAt: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

const columns = [
  { id: "todo", label: "未着手", color: "bg-gray-100 dark:bg-gray-800" },
  { id: "in-progress", label: "進行中", color: "bg-blue-100 dark:bg-blue-900" },
  { id: "done", label: "完了", color: "bg-green-100 dark:bg-green-900" },
];

export default function KanbanPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/tasks`);
      if (!res.ok) throw new Error("取得に失敗しました");
      const data = await res.json();
      setTasks(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id: number, status: string) => {
    const oldTasks = [...tasks];
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));

    try {
      const res = await fetch(`${API_BASE}/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("更新に失敗しました");
    } catch (e) {
      console.error(e);
      setTasks(oldTasks);
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

  const openTaskPanel = (taskId: number) => {
    setSelectedTaskId(taskId);
    setIsPanelOpen(true);
  };

  const closeTaskPanel = () => {
    setIsPanelOpen(false);
    setTimeout(() => setSelectedTaskId(null), 300);
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const getTasksByStatus = (status: string) =>
    tasks.filter((t) => t.status === status && !t.parentId);

  return (
    <div className="min-h-screen bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-black">
      <div className="mx-auto max-w-7xl px-4 py-8">
        {loading && tasks.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 dark:text-zinc-400">
            読み込み中...
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
                            : "bg-zinc-50 dark:bg-zinc-900"
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
                                    <a
                                      href={`/tasks/${task.id}?hideHeader=true`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300 transition-colors"
                                      onClick={(e) => e.stopPropagation()}
                                      title="別タブで開く (Ctrl+クリック)"
                                    >
                                      <svg
                                        className="w-4 h-4"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth={2}
                                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                        />
                                      </svg>
                                    </a>
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
                                      {getLabelsArray(task.labels).length > 3 && (
                                        <span className="text-xs text-zinc-500">
                                          +{getLabelsArray(task.labels).length - 3}
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
