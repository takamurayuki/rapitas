"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Task, Project, Milestone, Priority } from "@/types";
import TaskSlidePanel from "@/feature/tasks/components/task-slide-panel";
import TaskCard from "@/feature/tasks/components/task-card";
import { useToast } from "@/components/ui/toast/toast-container";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export default function Home() {
  const router = useRouter();
  const { showToast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<number | null>(null);
  const [milestoneFilter, setMilestoneFilter] = useState<number | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<Priority | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // クイック追加用
  const [isQuickAdding, setIsQuickAdding] = useState(false);
  const [quickTaskTitle, setQuickTaskTitle] = useState("");

  // ソート
  const [sortBy, setSortBy] = useState<"createdAt" | "priority" | "title">(
    "createdAt",
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // 複数選択
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);

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

  const fetchProjects = async () => {
    try {
      const res = await fetch(`${API_BASE}/projects`);
      const data = await res.json();
      setProjects(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchMilestones = async () => {
    try {
      const res = await fetch(`${API_BASE}/milestones`);
      const data = await res.json();
      setMilestones(data);
    } catch (e) {
      console.error(e);
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

  const openTaskPanel = (taskId: number) => {
    setSelectedTaskId(taskId);
    setIsPanelOpen(true);
  };

  const closeTaskPanel = () => {
    setIsPanelOpen(false);
    setTimeout(() => setSelectedTaskId(null), 300);
  };

  // クイックタスク追加
  const handleQuickAdd = async () => {
    if (!quickTaskTitle.trim()) return;

    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: quickTaskTitle,
          status: "todo",
          priority: "medium",
        }),
      });

      if (!res.ok) throw new Error("作成に失敗しました");
      const newTask = await res.json();
      setTasks((prev) => [newTask, ...prev]);
      setQuickTaskTitle("");
      setIsQuickAdding(false);
      showToast("タスクを作成しました", "success");
    } catch (e) {
      console.error(e);
      showToast("タスクの作成に失敗しました", "error");
    }
  };

  // バルク操作
  const toggleTaskSelection = (taskId: number) => {
    const newSelection = new Set(selectedTasks);
    if (newSelection.has(taskId)) {
      newSelection.delete(taskId);
    } else {
      newSelection.add(taskId);
    }
    setSelectedTasks(newSelection);
  };

  const bulkUpdateStatus = async (status: string) => {
    const taskIds = Array.from(selectedTasks);
    try {
      await Promise.all(
        taskIds.map((id) =>
          fetch(`${API_BASE}/tasks/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          }),
        ),
      );
      setTasks((prev) =>
        prev.map((t) => (taskIds.includes(t.id) ? { ...t, status } : t)),
      );
      showToast(`${taskIds.length}件のタスクを更新しました`, "success");
      setSelectedTasks(new Set());
      setIsSelectionMode(false);
    } catch (e) {
      showToast("一括更新に失敗しました", "error");
    }
  };

  const bulkDelete = async () => {
    if (!confirm(`${selectedTasks.size}件のタスクを削除しますか？`)) return;

    const taskIds = Array.from(selectedTasks);
    try {
      await Promise.all(
        taskIds.map((id) =>
          fetch(`${API_BASE}/tasks/${id}`, { method: "DELETE" }),
        ),
      );
      setTasks((prev) => prev.filter((t) => !taskIds.includes(t.id)));
      showToast(`${taskIds.length}件のタスクを削除しました`, "success");
      setSelectedTasks(new Set());
      setIsSelectionMode(false);
    } catch (e) {
      showToast("一括削除に失敗しました", "error");
    }
  };

  // キーボードショートカット
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // 入力フォーカス中は無効
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case "n":
          e.preventDefault();
          router.push("/tasks/new");
          break;
        case "q":
          e.preventDefault();
          setIsQuickAdding(true);
          break;
        case "s":
          e.preventDefault();
          setIsSelectionMode((prev) => !prev);
          if (isSelectionMode) {
            setSelectedTasks(new Set());
          }
          break;
        case "escape":
          if (isQuickAdding) {
            setIsQuickAdding(false);
            setQuickTaskTitle("");
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [router, isQuickAdding, isSelectionMode]);

  useEffect(() => {
    fetchTasks();
    fetchProjects();
    fetchMilestones();
  }, []);

  const filteredTasks = tasks.filter((t) => {
    if (t.parentId) return false;
    if (filter !== "all" && t.status !== filter) return false;
    if (projectFilter !== null && t.projectId !== projectFilter) return false;
    if (milestoneFilter !== null && t.milestoneId !== milestoneFilter)
      return false;
    if (priorityFilter !== null && t.priority !== priorityFilter) return false;
    return true;
  });

  // ソート処理
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "title":
        comparison = a.title.localeCompare(b.title);
        break;
      case "priority":
        const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
        comparison =
          (priorityOrder[a.priority as keyof typeof priorityOrder] || 0) -
          (priorityOrder[b.priority as keyof typeof priorityOrder] || 0);
        break;
      case "createdAt":
      default:
        comparison =
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
    }

    return sortOrder === "asc" ? comparison : -comparison;
  });

  const statusColors = {
    todo: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    "in-progress":
      "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    done: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-black">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* ヘッダー - ショートカットヒントとアクションボタン */}
        {!isPanelOpen && (
          <div className="mb-6 flex items-center justify-between">
            {/* <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                タスク一覧
              </h1>
              <div className="flex gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <kbd className="px-2 py-1 bg-zinc-200 dark:bg-zinc-800 rounded">
                  N
                </kbd>
                <span>新規作成</span>
                <kbd className="px-2 py-1 bg-zinc-200 dark:bg-zinc-800 rounded ml-2">
                  Q
                </kbd>
                <span>クイック追加</span>
                <kbd className="px-2 py-1 bg-zinc-200 dark:bg-zinc-800 rounded ml-2">
                  S
                </kbd>
                <span>一括選択</span>
              </div>
            </div> */}
            <div className="flex gap-2 ml-auto">
              <button
                onClick={() => setIsQuickAdding(true)}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium transition-colors flex items-center gap-2"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                クイック追加
              </button>
              <button
                onClick={() => router.push("/tasks/new")}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors flex items-center gap-2"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                新規タスク
              </button>
              <button
                onClick={() => {
                  setIsSelectionMode(!isSelectionMode);
                  setSelectedTasks(new Set());
                }}
                className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                  isSelectionMode
                    ? "bg-purple-600 text-white hover:bg-purple-700"
                    : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                <svg
                  className="w-5 h-5"
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
                {isSelectionMode
                  ? `一括選択 (${selectedTasks.size})`
                  : "一括選択"}
              </button>
            </div>
          </div>
        )}

        {/* クイック追加フォーム */}
        {isQuickAdding && (
          <div className="mb-4 p-4 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-blue-500 dark:border-blue-600">
            <div className="flex gap-2">
              <input
                type="text"
                value={quickTaskTitle}
                onChange={(e) => setQuickTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleQuickAdd();
                  if (e.key === "Escape") {
                    setIsQuickAdding(false);
                    setQuickTaskTitle("");
                  }
                }}
                placeholder="タスクタイトルを入力... (Enter で作成、Esc でキャンセル)"
                className="flex-1 px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <button
                onClick={handleQuickAdd}
                disabled={!quickTaskTitle.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                作成
              </button>
              <button
                onClick={() => {
                  setIsQuickAdding(false);
                  setQuickTaskTitle("");
                }}
                className="px-4 py-2 bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-300 dark:hover:bg-zinc-700 font-medium transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}

        {/* バルク操作バー */}
        {isSelectionMode && selectedTasks.size > 0 && (
          <div className="mb-4 p-4 bg-purple-100 dark:bg-purple-900 rounded-lg flex items-center justify-between">
            <span className="font-medium text-purple-900 dark:text-purple-100">
              {selectedTasks.size}件選択中
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => bulkUpdateStatus("todo")}
                className="px-3 py-1 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-300 dark:hover:bg-zinc-600 text-sm font-medium"
              >
                未着手にする
              </button>
              <button
                onClick={() => bulkUpdateStatus("in-progress")}
                className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm font-medium"
              >
                進行中にする
              </button>
              <button
                onClick={() => bulkUpdateStatus("done")}
                className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-sm font-medium"
              >
                完了にする
              </button>
              <button
                onClick={bulkDelete}
                className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm font-medium"
              >
                削除
              </button>
            </div>
          </div>
        )}

        {/* ステータスフィルター */}
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

        {/* 追加フィルター */}
        <div className="mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* プロジェクトフィルター */}
          <div>
            <select
              value={projectFilter || ""}
              onChange={(e) => {
                setProjectFilter(
                  e.target.value ? Number(e.target.value) : null,
                );
                setMilestoneFilter(null);
              }}
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">すべてのプロジェクト</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.icon} {project.name}
                </option>
              ))}
            </select>
          </div>

          {/* マイルストーンフィルター */}
          <div>
            <select
              value={milestoneFilter || ""}
              onChange={(e) =>
                setMilestoneFilter(
                  e.target.value ? Number(e.target.value) : null,
                )
              }
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">すべてのマイルストーン</option>
              {milestones
                .filter((m) => !projectFilter || m.projectId === projectFilter)
                .map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </option>
                ))}
            </select>
          </div>

          {/* 優先度フィルター */}
          <div>
            <select
              value={priorityFilter || ""}
              onChange={(e) =>
                setPriorityFilter(
                  e.target.value ? (e.target.value as Priority) : null,
                )
              }
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">すべての優先度</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="urgent">緊急</option>
            </select>
          </div>

          {/* ソート */}
          <div>
            <div className="flex gap-1">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="createdAt">作成日時</option>
                <option value="title">タイトル</option>
                <option value="priority">優先度</option>
              </select>
              <button
                onClick={() =>
                  setSortOrder((o) => (o === "asc" ? "desc" : "asc"))
                }
                className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title={sortOrder === "asc" ? "昇順" : "降順"}
              >
                <svg
                  className={`w-5 h-5 text-zinc-700 dark:text-zinc-300 transition-transform ${
                    sortOrder === "desc" ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 11l5-5m0 0l5 5m-5-5v12"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {loading && sortedTasks.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 dark:text-zinc-400">
            読み込み中...
          </div>
        ) : sortedTasks.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 dark:text-zinc-400">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-zinc-300 dark:text-zinc-700"
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
            <p className="text-lg font-medium mb-2">タスクがありません</p>
            <p className="text-sm mb-4">新しいタスクを作成してみましょう</p>
            <button
              onClick={() => router.push("/tasks/new")}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors inline-flex items-center gap-2"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              タスクを作成
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {sortedTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                isSelected={selectedTasks.has(task.id)}
                isSelectionMode={isSelectionMode}
                onTaskClick={openTaskPanel}
                onStatusChange={(taskId: number, status: string) => {
                  updateStatus(taskId, status);
                  showToast("ステータスを更新しました", "success");
                }}
                onToggleSelect={toggleTaskSelection}
                onTaskUpdated={fetchTasks}
              />
            ))}
          </div>
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
