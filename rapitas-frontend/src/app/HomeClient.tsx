"use client";
import { useEffect, useState } from "react";
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Task, Theme, Priority, Status } from "@/types";
import TaskSlidePanel from "@/feature/tasks/components/TaskSlidePanel";
import TaskCard from "@/feature/tasks/components/TaskCard";
import { useToast } from "@/components/ui/toast/ToastContainer";
import { useTaskDetailVisibilityStore } from "@/stores/taskDetailVisibilityStore";
import {
  statusConfig,
  renderStatusIcon,
} from "@/feature/tasks/config/StatusConfig";
import { SwatchBook, Star, ChevronDown, ChevronsUpDown, ChevronUp, ChevronsUp, X } from "lucide-react";
import { getIconComponent } from "@/components/category/IconData";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export default function HomeClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("search") || "";
  const { showToast } = useToast();
  const { showTaskDetail, hideTaskDetail } = useTaskDetailVisibilityStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
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

  // フィルターアコーディオン
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);

  const fetchTasks = async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks`);
      if (!res.ok) {
        const text = await res.text().catch(() => "<no body>");
        console.error("GET /tasks failed:", res.status, res.statusText, text);
        throw new Error("取得に失敗しました");
      }
      const data = await res.json();
      setTasks(data);
    } catch (e) {
      console.error(e);
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


  const openTaskPanel = (taskId: number) => {
    setSelectedTaskId(taskId);
    setIsPanelOpen(true);
    showTaskDetail();
  };

  const closeTaskPanel = () => {
    setIsPanelOpen(false);
    hideTaskDetail();
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
    } catch {
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
    } catch {
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
    // 初回読み込み時は両方のデータを取得してからloadingを解除
    const initialLoad = async () => {
      setLoading(true);
      await Promise.all([fetchTasks(), fetchThemes()]);
      setLoading(false);
    };
    initialLoad();

    // ページがフォーカスを取得したときにタスクを再読み込み（ローディング表示なし）
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
                {!isSelectionMode && (
                  <>
                    <button
                      onClick={() => setIsQuickAdding(!isQuickAdding)}
                      className={`px-3 py-1.5  rounded text-xs transition-all flex items-center gap-1.5 bg-green-50 ${
                        isQuickAdding
                          ? "bg-green-500 dark:bg-green-600 text-white shadow-sm"
                          : "text-green-600 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/30"
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
                      className="px-3 py-1.5 bg-blue-50 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/30 rounded text-xs transition-all flex items-center gap-1.5"
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
                  </>
                )}

                {/* 全選択ボタン（選択モード時のみ表示、一括ボタンの左に配置） */}
                {isSelectionMode && (
                  <>
                    <button
                      onClick={() => {
                        if (selectedTasks.size === paginatedTasks.length) {
                          setSelectedTasks(new Set());
                        } else {
                          setSelectedTasks(new Set(paginatedTasks.map((t) => t.id)));
                        }
                      }}
                      className={`px-3 py-1.5 rounded text-xs transition-all flex items-center gap-1.5 ${
                        selectedTasks.size === paginatedTasks.length && paginatedTasks.length > 0
                          ? "bg-blue-500 dark:bg-blue-600 text-white shadow-sm"
                          : "bg-blue-50 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/30"
                      }`}
                      title={selectedTasks.size === paginatedTasks.length ? "全解除" : "全選択"}
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        {selectedTasks.size === paginatedTasks.length && paginatedTasks.length > 0 ? (
                          /* 全解除: 四角から外れるアイコン */
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        ) : (
                          /* 全選択: ダブルチェックマークアイコン */
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 12l2 2 4-4m5 2a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        )}
                      </svg>
                      <span>
                        {selectedTasks.size === paginatedTasks.length && paginatedTasks.length > 0
                          ? "全解除"
                          : "全選択"}
                      </span>
                    </button>

                    <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700"></div>
                  </>
                )}

                <button
                  onClick={() => {
                    setIsSelectionMode(!isSelectionMode);
                    setSelectedTasks(new Set());
                  }}
                  className={`px-3 py-1.5 rounded text-xs transition-all flex items-center gap-1.5 bg-purple-50 ${
                    isSelectionMode
                      ? "bg-purple-500 dark:bg-purple-600 text-white shadow-sm"
                      : "text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-900/30"
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

        {/* 統合フィルターバー（アコーディオン） */}
        {!loading && !isSelectionMode && !isQuickAdding && (
          <div className="mb-4 bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            {/* テーマ選択（アコーディオンヘッダー） */}
            <div className="flex items-center gap-2 px-3 py-2.5">
              {/* テーマボタン */}
              <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent flex-1">
                <button
                  onClick={() => setThemeFilter(null)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    themeFilter === null
                      ? "bg-purple-600 text-white shadow-lg"
                      : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-300 dark:border-zinc-700"
                  }`}
                >
                  すべて
                </button>
                {themes.map((theme) => {
                  const IconComponent = getIconComponent(theme.icon || "") || SwatchBook;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => setThemeFilter(theme.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        themeFilter === theme.id
                          ? "shadow-lg"
                          : "border border-zinc-300 dark:border-zinc-700 hover:border-current"
                      }`}
                      style={{
                        backgroundColor: themeFilter === theme.id ? theme.color : undefined,
                        color: themeFilter === theme.id ? "#ffffff" : theme.color,
                        borderColor: themeFilter === theme.id ? theme.color : undefined,
                      }}
                    >
                      <IconComponent className="w-3.5 h-3.5" />
                      {theme.name}
                      {theme.isDefault && <Star className="w-3 h-3 fill-current" />}
                    </button>
                  );
                })}
              </div>

              {/* アコーディオントグル */}
              <button
                onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0 ${
                  isFilterExpanded
                    ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                <span className="hidden sm:inline">フィルター</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isFilterExpanded ? "rotate-180" : ""}`} />
              </button>
            </div>

            {/* フィルター・ソート（アコーディオンコンテンツ） */}
            <div
              className={`overflow-hidden transition-all duration-200 ease-in-out ${
                isFilterExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
              }`}
            >
              <div className="flex flex-wrap items-center gap-4 px-3 py-2.5 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
                {/* ステータス */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                    ステータス:
                  </span>
                  <div className="flex items-center gap-1">
                    {["all", "todo", "in-progress", "done"].map((status) => {
                      const statusConfigLocal = {
                        all: { label: "すべて", color: "purple" },
                        todo: { label: "未着手", color: "zinc" },
                        "in-progress": { label: "進行中", color: "blue" },
                        done: { label: "完了", color: "green" },
                      };
                      const config = statusConfigLocal[status as keyof typeof statusConfigLocal];
                      const count = tasks.filter((t) => {
                        if (t.parentId) return false;
                        if (status !== "all" && t.status !== status) return false;
                        if (themeFilter !== null && t.themeId !== themeFilter) return false;
                        if (priorityFilter !== null && t.priority !== priorityFilter) return false;
                        if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                        return true;
                      }).length;

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
                              : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700"
                          }`}
                        >
                          {config.label}
                          <span className="text-[10px] opacity-75">({count})</span>
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
                  <div className="flex items-center gap-1">
                    {[
                      { value: "", label: "すべて", icon: null, iconColor: "", bgColor: "bg-purple-600" },
                      { value: "urgent", label: "緊急", icon: <ChevronsUp className="w-3.5 h-3.5" />, iconColor: "text-red-500", bgColor: "bg-red-500" },
                      { value: "high", label: "高", icon: <ChevronUp className="w-3.5 h-3.5" />, iconColor: "text-orange-500", bgColor: "bg-orange-500" },
                      { value: "medium", label: "中", icon: <ChevronsUpDown className="w-3.5 h-3.5" />, iconColor: "text-blue-500", bgColor: "bg-blue-500" },
                      { value: "low", label: "低", icon: <ChevronDown className="w-3.5 h-3.5" />, iconColor: "text-zinc-400", bgColor: "bg-zinc-500" },
                    ].map((priority) => (
                      <button
                        key={priority.value}
                        onClick={() => setPriorityFilter(priority.value ? (priority.value as Priority) : null)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                          (priorityFilter || "") === priority.value
                            ? `${priority.bgColor} text-white shadow-md`
                            : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700"
                        }`}
                      >
                        {priority.icon && (
                          <span className={(priorityFilter || "") === priority.value ? "text-white" : priority.iconColor}>
                            {priority.icon}
                          </span>
                        )}
                        {priority.label}
                      </button>
                    ))}
                  </div>
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
                    onClick={() => setSortOrder((o) => (o === "asc" ? "desc" : "asc"))}
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
          </div>
        )}

        {loading ? (
          <div className="animate-pulse space-y-4">
            {/* 統合フィルターUIスケルトン（アコーディオン） */}
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
              {/* テーマ選択スケルトン */}
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="flex items-center gap-2 flex-1">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-8 w-20 bg-zinc-200 dark:bg-zinc-700 rounded-lg" />
                  ))}
                </div>
                <div className="h-8 w-24 bg-zinc-200 dark:bg-zinc-700 rounded-lg" />
              </div>
            </div>

            {/* タスクカードスケルトン */}
            <div className="grid gap-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-sm border border-zinc-200 dark:border-zinc-800"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 bg-zinc-200 dark:bg-zinc-700 rounded-md shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-5 w-3/4 bg-zinc-200 dark:bg-zinc-700 rounded" />
                      <div className="h-4 w-1/2 bg-zinc-200 dark:bg-zinc-700 rounded" />
                    </div>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3].map((j) => (
                        <div key={j} className="h-7 w-7 bg-zinc-200 dark:bg-zinc-700 rounded-md" />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
