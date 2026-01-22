"use client";
import { useEffect, useState } from "react";
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Task, Theme, Priority, Status } from "@/types";
import TaskSlidePanel from "@/feature/tasks/components/task-slide-panel";
import TaskCard from "@/feature/tasks/components/task-card";
import { useToast } from "@/components/ui/toast/toast-container";
import {
  statusConfig,
  renderStatusIcon,
} from "@/feature/tasks/config/status-config";
import TaskStatusChange from "@/feature/tasks/components/task-status-change";
import { Palette, Star } from "lucide-react";
import { getIconComponent, ICON_DATA } from "@/components/category/icon-data";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export default function HomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("search") || "";
  const { showToast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [themeFilter, setThemeFilter] = useState<number | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<Priority | null>(null);
  const [defaultTheme, setDefaultTheme] = useState<Theme | null>(null);
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

  // ページネーション
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

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

  const fetchThemes = async () => {
    try {
      const res = await fetch(`${API_BASE}/themes`);
      const data = await res.json();
      setThemes(data);
      // デフォルトテーマを設定し、自動選択
      const defaultThemeData = data.find((t: Theme) => t.isDefault);
      if (defaultThemeData) {
        setDefaultTheme(defaultThemeData);
        // 初回表示時にデフォルトテーマを自動選択
        setThemeFilter(defaultThemeData.id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const updateStatus = async (id: number, status: Status) => {
    const oldTasks = [...tasks];
    setTasks((prev: Task[]) =>
      prev.map((t: Task) => (t.id === id ? { ...t, status } : t)),
    );

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
    setTasks((prev: Task[]) => prev.filter((t: Task) => t.id !== id));

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
          ...(themeFilter && { themeId: themeFilter }),
          ...(!themeFilter && defaultTheme && { themeId: defaultTheme.id }),
        }),
      });

      if (!res.ok) throw new Error("作成に失敗しました");
      const newTask = await res.json();
      setQuickTaskTitle("");
      setIsQuickAdding(false);
      showToast("タスクを作成しました", "success");
      // サーバーから最新データを再取得（theme情報を含む）
      await fetchTasks();
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
      setTasks((prev: Task[]) =>
        prev.map((t: Task) =>
          taskIds.includes(t.id) ? { ...t, status: status as Status } : t,
        ),
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
      setTasks((prev: Task[]) =>
        prev.filter((t: Task) => !taskIds.includes(t.id)),
      );
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
          const themeParam = themeFilter || defaultTheme?.id;
          router.push(
            `/tasks/new${themeParam ? `?themeId=${themeParam}` : ""}`,
          );
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
    fetchThemes();

    // ページがフォーカスを取得したときにタスクを再読み込み
    const handleFocus = () => {
      fetchTasks();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  const filteredTasks = tasks.filter((t) => {
    if (t.parentId) return false;
    if (filter !== "all" && t.status !== filter) return false;
    if (themeFilter !== null && t.themeId !== themeFilter) return false;
    if (priorityFilter !== null && t.priority !== priorityFilter) return false;

    // 検索フィルター
    if (
      searchQuery &&
      !t.title.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }

    return true;
  });

  // フィルター変更時にページを1に戻す
  useEffect(() => {
    setCurrentPage(1);
  }, [filter, themeFilter, priorityFilter, searchQuery]);

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

  // ページネーション処理
  const totalPages = Math.ceil(sortedTasks.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedTasks = sortedTasks.slice(startIndex, endIndex);

  // ページ変更時にページ数が超えていたら調整
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const statusColors = {
    todo: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    "in-progress":
      "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    done: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-black">
      <div className="mx-auto max-w-6xl px-4 py-4">
        {/* ヘッダー - アクションボタン */}
        {!isPanelOpen && (
          <div className="mb-4 flex items-center justify-end">
            <div className="flex items-center gap-2">
              {/* バルク操作ボタン（選択時のみ表示） */}
              {isSelectionMode && selectedTasks.size > 0 && (
                <>
                  {/* ステータス変更ボタングループ */}
                  <div className="flex items-center gap-1 bg-white dark:bg-zinc-800 rounded-md shadow-sm p-1 border border-zinc-200 dark:border-zinc-700">
                    {["todo", "in-progress", "done"].map((status, idx, arr) => {
                      const config =
                        statusConfig[status as keyof typeof statusConfig];
                      const colorClasses =
                        status === "todo"
                          ? "hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400"
                          : status === "in-progress"
                            ? "hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                            : "hover:bg-green-50 dark:hover:bg-green-900/30 text-green-600 dark:text-green-400";

                      const isLast = idx === arr.length - 1;
                      return (
                        <React.Fragment key={status}>
                          <button
                            onClick={() => bulkUpdateStatus(status)}
                            className={`px-2.5 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-1 ${colorClasses}`}
                            title={`${config.label}に変更`}
                          >
                            <span className="w-3.5 h-3.5">
                              {renderStatusIcon(status)}
                            </span>
                            <span>{config.label}</span>
                          </button>
                          {!isLast && (
                            <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700"></div>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>

                  <div className="w-px h-7 bg-zinc-300 dark:bg-zinc-600"></div>
                </>
              )}

              {/* メインアクションボタン */}
              <div className="flex items-center gap-1 bg-white dark:bg-zinc-800 rounded-md shadow-md p-1 border border-zinc-200 dark:border-zinc-700">
                <button
                  onClick={() => setIsQuickAdding(!isQuickAdding)}
                  className={`px-3 py-1.5  rounded text-xs transition-all flex items-center gap-1.5 ${
                    isQuickAdding
                      ? "bg-green-500 dark:bg-green-600 text-white shadow-sm"
                      : "text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30"
                  }`}
                  title="クイック追加 (Q)"
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
                      strokeWidth={2.5}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  <span>クイック</span>
                </button>

                <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700"></div>

                <button
                  onClick={() => {
                    const themeParam = themeFilter || defaultTheme?.id;
                    router.push(
                      `/tasks/new${themeParam ? `?themeId=${themeParam}` : ""}`,
                    );
                  }}
                  className="px-3 py-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded text-xs transition-all flex items-center gap-1.5"
                  title="新規タスク (N)"
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
                      d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <span>新規</span>
                </button>

                <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700"></div>

                <button
                  onClick={() => {
                    setIsSelectionMode(!isSelectionMode);
                    setSelectedTasks(new Set());
                  }}
                  className={`px-3 py-1.5 rounded text-xs transition-all flex items-center gap-1.5 ${
                    isSelectionMode
                      ? "bg-purple-500 dark:bg-purple-600 text-white shadow-sm"
                      : "text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/30"
                  }`}
                  title="一括選択モード (S)"
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
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                    />
                  </svg>
                  <span>
                    {isSelectionMode
                      ? `選択中 (${selectedTasks.size})`
                      : "一括"}
                  </span>
                </button>

                {isSelectionMode && selectedTasks.size > 0 && (
                  <>
                    <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700"></div>

                    {/* 削除ボタン */}
                    <button
                      onClick={bulkDelete}
                      className="px-3 py-1.5 bg-red-500 dark:bg-red-600 text-white rounded hover:bg-red-600 dark:hover:bg-red-700 text-xs transition-all hover:shadow-md flex items-center gap-1.5 shadow-sm"
                      title="選択したタスクを削除"
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
                      削除
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* クイック追加フォーム */}
        {isQuickAdding && (
          <div className="mb-4 p-3 bg-white dark:bg-zinc-900 rounded-lg shadow-lg">
            <div className="flex gap-2 p-n2">
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
                className="text-sm px-2 flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
              <button
                onClick={handleQuickAdd}
                disabled={!quickTaskTitle.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                作成
              </button>
            </div>
          </div>
        )}

        {/* ステータスフィルター */}
        {!isSelectionMode && !isQuickAdding && (
          <>
            <div className="mb-4 bg-white dark:bg-zinc-900 rounded-lg p-3 shadow-sm border border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-4">
                {/* ステータス */}
                <div className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0"
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
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                    ステータス:
                  </span>
                  <div className="flex items-center gap-1">
                    {["all", "todo", "in-progress", "done"].map((status) => {
                      const statusConfig = {
                        all: { label: "すべて", color: "purple" },
                        todo: { label: "未着手", color: "zinc" },
                        "in-progress": { label: "進行中", color: "blue" },
                        done: { label: "完了", color: "green" },
                      };
                      const config =
                        statusConfig[status as keyof typeof statusConfig];
                      const count = tasks.filter(
                        (t) => status === "all" || t.status === status,
                      ).length;

                      return (
                        <button
                          key={status}
                          onClick={() => setFilter(status)}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                            filter === status
                              ? config.color === "purple"
                                ? "bg-purple-600 text-white shadow-md"
                                : config.color === "blue"
                                  ? "bg-blue-600 text-white shadow-md"
                                  : config.color === "green"
                                    ? "bg-green-600 text-white shadow-md"
                                    : "bg-zinc-600 text-white shadow-md"
                              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                          }`}
                        >
                          {config.label}
                          <span className="text-[10px] opacity-75">
                            ({count})
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 区切り線 */}
                <div className="w-px h-6 bg-zinc-300 dark:bg-zinc-700"></div>

                {/* 優先度 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                    優先度:
                  </span>
                  <select
                    value={priorityFilter || ""}
                    onChange={(e) =>
                      setPriorityFilter(
                        e.target.value ? (e.target.value as Priority) : null,
                      )
                    }
                    className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 whitespace-nowrap"
                  >
                    <option value="">すべて</option>
                    <option value="low">低</option>
                    <option value="medium">中</option>
                    <option value="high">高</option>
                    <option value="urgent">緊急</option>
                  </select>
                </div>

                {/* 区切り線 */}
                <div className="w-px h-6 bg-zinc-300 dark:bg-zinc-700"></div>

                {/* ソート */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                    並び:
                  </span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 whitespace-nowrap"
                  >
                    <option value="createdAt">作成日時</option>
                    <option value="title">タイトル</option>
                    <option value="priority">優先度</option>
                  </select>
                  <button
                    onClick={() =>
                      setSortOrder((o) => (o === "asc" ? "desc" : "asc"))
                    }
                    className="p-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                    title={sortOrder === "asc" ? "昇順" : "降順"}
                  >
                    <svg
                      className={`w-3.5 h-3.5 text-zinc-700 dark:text-zinc-300 transition-transform ${
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
          </>
        )}

        {/* テーマ選択とフィルター */}
        {!isSelectionMode && !isQuickAdding && (
          <>
            <div className="mb-4 bg-white dark:bg-zinc-900 rounded-lg p-3 shadow-sm border border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2 mb-2">
                <Palette className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {themeFilter ? (
                    <>
                      <span className="text-purple-600 dark:text-purple-400">
                        {themes.find((t) => t.id === themeFilter)?.name}
                      </span>
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {" "}
                        でタスクを管理中
                      </span>
                      <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-2">
                        (新規作成時も自動的にこのテーマに紐づきます)
                      </span>
                    </>
                  ) : (
                    <span className="text-zinc-500 dark:text-zinc-400">
                      テーマを選択してタスクを管理 • 全テーマのタスクを表示中
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent pb-1">
                {/* テーマボタン */}
                <button
                  onClick={() => setThemeFilter(null)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                    themeFilter === null
                      ? "bg-purple-600 text-white shadow-lg"
                      : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-300 dark:border-zinc-700"
                  }`}
                >
                  <Palette className="w-3.5 h-3.5" />
                  すべて
                </button>
                {themes.map((theme) => {
                  const IconComponent = getIconComponent(theme.icon || "") || Palette;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => setThemeFilter(theme.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                        themeFilter === theme.id
                          ? "shadow-lg scale-105"
                          : "hover:scale-105 border border-zinc-300 dark:border-zinc-700"
                      }`}
                      style={{
                        backgroundColor:
                          themeFilter === theme.id ? theme.color : undefined,
                        color:
                          themeFilter === theme.id ? "#ffffff" : theme.color,
                        borderColor:
                          themeFilter === theme.id ? theme.color : undefined,
                      }}
                    >
                      <IconComponent className="w-3.5 h-3.5" />
                      {theme.name}
                      {theme.isDefault && (
                        <Star className="w-3 h-3 fill-current" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

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
              onClick={() => {
                const themeParam = themeFilter || defaultTheme?.id;
                router.push(
                  `/tasks/new${themeParam ? `?themeId=${themeParam}` : ""}`,
                );
              }}
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
          <>
            <div className="grid gap-3">
              {paginatedTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  isSelected={selectedTasks.has(task.id)}
                  isSelectionMode={isSelectionMode}
                  onTaskClick={openTaskPanel}
                  onStatusChange={(taskId: number, status: Status) => {
                    updateStatus(taskId, status);
                    showToast("ステータスを更新しました", "success");
                  }}
                  onToggleSelect={toggleTaskSelection}
                  onTaskUpdated={fetchTasks}
                />
              ))}
            </div>

            {/* ページネーション */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-3">
                {/* 表示件数 */}
                <div className="flex items-center gap-1">
                  {[5, 10, 15].map((count) => (
                    <button
                      key={count}
                      onClick={() => {
                        setItemsPerPage(count);
                        setCurrentPage(1);
                      }}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                        itemsPerPage === count
                          ? "bg-purple-600 text-white"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>

                <div className="w-px h-5 bg-zinc-300 dark:bg-zinc-700"></div>

                {/* ページネーションコントロール */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="最初のページ"
                  >
                    <svg
                      className="w-4 h-4 text-zinc-600 dark:text-zinc-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                      />
                    </svg>
                  </button>

                  <button
                    onClick={() =>
                      setCurrentPage((prev) => Math.max(1, prev - 1))
                    }
                    disabled={currentPage === 1}
                    className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="前のページ"
                  >
                    <svg
                      className="w-4 h-4 text-zinc-600 dark:text-zinc-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                  </button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((page) => {
                      return (
                        page === 1 ||
                        page === totalPages ||
                        (page >= currentPage - 1 && page <= currentPage + 1)
                      );
                    })
                    .map((page, index, array) => (
                      <React.Fragment key={page}>
                        {index > 0 && array[index - 1] !== page - 1 && (
                          <span className="px-1 text-zinc-400 text-xs">
                            •••
                          </span>
                        )}
                        <button
                          onClick={() => setCurrentPage(page)}
                          className={`min-w-28px px-2.5 py-1 rounded text-xs font-medium transition-all ${
                            currentPage === page
                              ? "bg-purple-600 text-white"
                              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                          }`}
                        >
                          {page}
                        </button>
                      </React.Fragment>
                    ))}

                  <button
                    onClick={() =>
                      setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                    }
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="次のページ"
                  >
                    <svg
                      className="w-4 h-4 text-zinc-600 dark:text-zinc-400"
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
                  </button>

                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="最後のページ"
                  >
                    <svg
                      className="w-4 h-4 text-zinc-600 dark:text-zinc-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 5l7 7-7 7M5 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </>
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
