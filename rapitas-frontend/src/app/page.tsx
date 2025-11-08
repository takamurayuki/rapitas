"use client";
import { useEffect, useState } from "react";

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

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskDescription, setSubtaskDescription] = useState("");
  const [subtaskLabels, setSubtaskLabels] = useState("");
  const [subtaskEstimatedHours, setSubtaskEstimatedHours] = useState("");

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
      description: description || null,
      status: "todo",
      labels: labels ? labels.split(",").map((l) => l.trim()) : [],
      estimatedHours: estimatedHours ? parseFloat(estimatedHours) : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setTasks((prev) => [optimisticTask, ...prev]);
    setTitle("");
    setDescription("");
    setLabels("");
    setEstimatedHours("");

    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || undefined,
          labels: labels ? labels.split(",").map((l) => l.trim()) : undefined,
          estimatedHours: estimatedHours ? parseFloat(estimatedHours) : undefined,
        }),
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

  const addSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subtaskTitle.trim() || !selectedTask) return;

    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: subtaskTitle,
          description: subtaskDescription || undefined,
          labels: subtaskLabels ? subtaskLabels.split(",").map((l) => l.trim()) : undefined,
          estimatedHours: subtaskEstimatedHours ? parseFloat(subtaskEstimatedHours) : undefined,
          parentId: selectedTask.id,
        }),
      });
      if (!res.ok) throw new Error("サブタスク作成に失敗しました");
      const newSubtask = await res.json();

      setTasks((prev) =>
        prev.map((t) =>
          t.id === selectedTask.id
            ? { ...t, subtasks: [...(t.subtasks || []), newSubtask] }
            : t
        )
      );
      setSubtaskTitle("");
      setSubtaskDescription("");
      setSubtaskLabels("");
      setSubtaskEstimatedHours("");
    } catch (e) {
      console.error(e);
    }
  };

  const deleteSubtask = async (parentId: number, subtaskId: number) => {
    const oldTasks = [...tasks];
    setTasks((prev) =>
      prev.map((t) =>
        t.id === parentId
          ? { ...t, subtasks: t.subtasks?.filter((s) => s.id !== subtaskId) }
          : t
      )
    );

    try {
      const res = await fetch(`${API_BASE}/tasks/${subtaskId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("削除に失敗しました");
    } catch (e) {
      console.error(e);
      setTasks(oldTasks);
    }
  };

  const updateSubtaskStatus = async (
    parentId: number,
    subtaskId: number,
    status: string
  ) => {
    const oldTasks = [...tasks];
    setTasks((prev) =>
      prev.map((t) =>
        t.id === parentId
          ? {
              ...t,
              subtasks: t.subtasks?.map((s) =>
                s.id === subtaskId ? { ...s, status } : s
              ),
            }
          : t
      )
    );

    try {
      const res = await fetch(`${API_BASE}/tasks/${subtaskId}`, {
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

  useEffect(() => {
    fetchTasks();
  }, []);

  const filteredTasks = tasks.filter(
    (t) => filter === "all" || t.status === filter
  );

  const statusColors = {
    todo: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    "in-progress":
      "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    done: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-black">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-zinc-900 dark:text-zinc-50 mb-2">
              Rapitas
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              高速で直感的なタスク管理
            </p>
          </div>
          <a
            href="/kanban"
            className="rounded-lg bg-zinc-800 dark:bg-zinc-200 px-4 py-2 text-sm font-medium text-white dark:text-zinc-900 hover:opacity-80 transition-opacity"
          >
            カンバン表示へ
          </a>
        </header>

        <form onSubmit={addTask} className="mb-6 space-y-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm">
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="タスクタイトル *"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-blue-700 transition-colors"
            >
              追加
            </button>
          </div>
          <textarea
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="説明（任意）"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="ラベル（カンマ区切り）"
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
            />
            <input
              type="number"
              step="0.5"
              min="0"
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="見積もり時間（h）"
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value)}
            />
          </div>
        </form>

        <div className="mb-4 flex gap-2">
          {["all", "todo", "in-progress", "done"].map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                filter === status
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
              }`}
            >
              {status === "all"
                ? "すべて"
                : status === "todo"
                ? "未着手"
                : status === "in-progress"
                ? "進行中"
                : "完了"}
              <span className="ml-2 text-xs opacity-70">
                (
                {
                  tasks.filter((t) => status === "all" || t.status === status)
                    .length
                }
                )
              </span>
            </button>
          ))}
        </div>

        {loading && filteredTasks.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 dark:text-zinc-400">
            読み込み中...
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 dark:text-zinc-400">
            タスクがありません
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTasks.map((task) => (
              <div key={task.id} className="space-y-2">
                <div className="flex items-start justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex-1">
                    <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                      {task.title}
                    </h3>
                    {task.description && (
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                        {task.description}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 mt-2">
                      {task.labels && task.labels.length > 0 && (
                        <div className="flex gap-1">
                          {task.labels.map((label, idx) => (
                            <span
                              key={idx}
                              className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                      {task.estimatedHours && (
                        <span className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                          ⏱ {task.estimatedHours}h
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
                      {new Date(task.createdAt).toLocaleString("ja-JP")}
                      {task.subtasks && task.subtasks.length > 0 && (
                        <span className="ml-2 text-blue-600 dark:text-blue-400">
                          • サブタスク {task.subtasks.length}件
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => setSelectedTask(task)}
                      className="rounded-md px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
                    >
                      詳細
                    </button>

                    <select
                      value={task.status}
                      onChange={(e) => updateStatus(task.id, e.target.value)}
                      className={`rounded-md px-3 py-1 text-xs font-medium ${
                        statusColors[task.status as keyof typeof statusColors]
                      } border-0 focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    >
                      <option value="todo">未着手</option>
                      <option value="in-progress">進行中</option>
                      <option value="done">完了</option>
                    </select>

                    <button
                      onClick={() => deleteTask(task.id)}
                      className="rounded-md px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                    >
                      削除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedTask && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-zinc-900 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-xl">
              <div className="sticky top-0 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700 px-6 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {selectedTask.title}
                  </h2>
                  <button
                    onClick={() => setSelectedTask(null)}
                    className="rounded-md px-3 py-1 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    閉じる
                  </button>
                </div>
              </div>

              <div className="px-6 py-4">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-3">
                  サブタスク
                </h3>

                <form onSubmit={addSubtask} className="mb-4 space-y-2">
                  <input
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="サブタスクタイトル *"
                    value={subtaskTitle}
                    onChange={(e) => setSubtaskTitle(e.target.value)}
                    required
                  />
                  <textarea
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="説明（任意）"
                    value={subtaskDescription}
                    onChange={(e) => setSubtaskDescription(e.target.value)}
                    rows={2}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="ラベル（カンマ区切り）"
                      value={subtaskLabels}
                      onChange={(e) => setSubtaskLabels(e.target.value)}
                    />
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="見積もり時間（h）"
                      value={subtaskEstimatedHours}
                      onChange={(e) => setSubtaskEstimatedHours(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 transition-colors"
                  >
                    サブタスクを追加
                  </button>
                </form>

                {selectedTask.subtasks && selectedTask.subtasks.length > 0 ? (
                  <div className="space-y-2">
                    {selectedTask.subtasks.map((subtask) => (
                      <div
                        key={subtask.id}
                        className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-3"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                              {subtask.title}
                            </h4>
                            {subtask.description && (
                              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                                {subtask.description}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() =>
                              deleteSubtask(selectedTask.id, subtask.id)
                            }
                            className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 ml-2"
                          >
                            削除
                          </button>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex flex-wrap gap-1">
                            {subtask.labels && subtask.labels.length > 0 && (
                              <>
                                {subtask.labels.map((label, idx) => (
                                  <span
                                    key={idx}
                                    className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                                  >
                                    {label}
                                  </span>
                                ))}
                              </>
                            )}
                            {subtask.estimatedHours && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                                ⏱ {subtask.estimatedHours}h
                              </span>
                            )}
                          </div>
                          <select
                            value={subtask.status}
                            onChange={(e) =>
                              updateSubtaskStatus(
                                selectedTask.id,
                                subtask.id,
                                e.target.value
                              )
                            }
                            className={`rounded-md px-2 py-1 text-xs font-medium ${
                              statusColors[
                                subtask.status as keyof typeof statusColors
                              ]
                            } border-0 focus:outline-none focus:ring-2 focus:ring-blue-500`}
                          >
                            <option value="todo">未着手</option>
                            <option value="in-progress">進行中</option>
                            <option value="done">完了</option>
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-4">
                    サブタスクがありません
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
