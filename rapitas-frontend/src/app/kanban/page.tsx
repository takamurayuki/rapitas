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

type Task = {
  id: number;
  title: string;
  status: string;
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
  const [title, setTitle] = useState("");

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

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const optimisticTask: Task = {
      id: Date.now(),
      title,
      status: "todo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setTasks((prev) => [optimisticTask, ...prev]);
    setTitle("");

    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error("作成に失敗しました");
      const newTask = await res.json();
      setTasks((prev) =>
        prev.map((t) => (t.id === optimisticTask.id ? newTask : t))
      );
    } catch (e) {
      console.error(e);
      setTasks((prev) => prev.filter((t) => t.id !== optimisticTask.id));
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

  const deleteTask = async (id: number) => {
    const oldTasks = [...tasks];
    setTasks((prev) => prev.filter((t) => t.id !== id));

    try {
      const res = await fetch(`${API_BASE}/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("削除に失敗しました");
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

  useEffect(() => {
    fetchTasks();
  }, []);

  const getTasksByStatus = (status: string) =>
    tasks.filter((t) => t.status === status);

  return (
    <div className="min-h-screen bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-black">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-zinc-900 dark:text-zinc-50 mb-2">
              Rapitas カンバン
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              ドラッグ&ドロップでタスクを管理
            </p>
          </div>
          <a
            href="/"
            className="rounded-lg bg-zinc-800 dark:bg-zinc-200 px-4 py-2 text-sm font-medium text-white dark:text-zinc-900 hover:opacity-80 transition-opacity"
          >
            リスト表示へ
          </a>
        </header>

        <form onSubmit={addTask} className="mb-6 flex gap-2">
          <input
            className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="新しいタスクを入力..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-blue-700 transition-colors"
          >
            追加
          </button>
        </form>

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
                      snapshot: DroppableStateSnapshot
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
                                snapshot: DraggableStateSnapshot
                              ) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={`rounded-lg border bg-white dark:bg-zinc-800 p-3 shadow-sm transition-shadow ${
                                    snapshot.isDragging
                                      ? "shadow-lg border-blue-500"
                                      : "border-zinc-200 dark:border-zinc-700 hover:shadow-md"
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <h3 className="flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                                      {task.title}
                                    </h3>
                                    <button
                                      onClick={() => deleteTask(task.id)}
                                      className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                                    >
                                      削除
                                    </button>
                                  </div>
                                  <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                                    {new Date(
                                      task.createdAt
                                    ).toLocaleDateString("ja-JP")}
                                  </p>
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
    </div>
  );
}
