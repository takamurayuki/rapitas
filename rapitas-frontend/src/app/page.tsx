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
  const [filter, setFilter] = useState<string>("all");

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

  useEffect(() => {
    fetchTasks();
  }, []);

  const filteredTasks = tasks.filter(
    (t) => !t.parentId && (filter === "all" || t.status === filter)
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
                <div className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-zinc-900 dark:text-zinc-50 truncate">
                        {task.title}
                      </h3>
                      <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        <span>
                          {new Date(task.createdAt).toLocaleDateString("ja-JP")}
                        </span>
                        {task.subtasks && task.subtasks.length > 0 && (
                          <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
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
                                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                              />
                            </svg>
                            {
                              task.subtasks.filter((s) => s.status === "done")
                                .length
                            }
                            /{task.subtasks.length}
                          </span>
                        )}
                        {task.labels && task.labels.length > 0 && (
                          <span className="flex items-center gap-1">
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
                                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                              />
                            </svg>
                            {task.labels.length}
                          </span>
                        )}
                        {task.estimatedHours && (
                          <span className="flex items-center gap-1">
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
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                            {task.estimatedHours}h
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <a
                      href={`/tasks/${task.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors"
                      title="新しいタブで開く"
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
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
