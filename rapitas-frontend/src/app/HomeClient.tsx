"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Theme, Category, Priority, Status, UserSettings } from "@/types";
import TaskSlidePanel from "@/feature/tasks/components/TaskSlidePanel";
import TaskCard from "@/feature/tasks/components/TaskCard";
import { useToast } from "@/components/ui/toast/ToastContainer";
import { useTaskDetailVisibilityStore } from "@/stores/taskDetailVisibilityStore";
import Pagination from "@/components/ui/pagination/Pagination";
import {
  statusConfig,
  renderStatusIcon,
} from "@/feature/tasks/config/StatusConfig";
// import TaskCompleteOverlay from "@/feature/tasks/components/TaskCompleteOverlay";
import {
  SwatchBook,
  Star,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  ChevronsUp,
  FolderKanban,
  Code,
  BookOpen,
  Layers,
  Plus,
} from "lucide-react";
import { getIconComponent } from "@/components/category/IconData";
import { API_BASE_URL } from "@/utils/api";
import { useExecutingTasksPolling } from "@/hooks/useExecutingTasksPolling";
import { useAppModeStore } from "@/stores/appModeStore";
import { useTaskCacheStore } from "@/stores/taskCacheStore";
import {
  ProgressRing,
  CardLightSweep,
  FlyingParticle,
  useTaskCompletionAnimation,
} from "@/feature/tasks/components/TaskCompletionAnimation";
import { useFilteredTasks } from "@/hooks/useFilteredTasks";
import { useTaskSorting } from "@/hooks/useTaskSorting";
import { useLocalStorageState } from "@/hooks/useLocalStorageState";
import { useDebounce } from "@/hooks/useDebounce";

const API_BASE = API_BASE_URL;

export default function HomeClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("search") || "";
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const { showToast } = useToast();
  const { showTaskDetail, hideTaskDetail } = useTaskDetailVisibilityStore();
  const appMode = useAppModeStore((state) => state.mode);
  const tasks = useTaskCacheStore((s) => s.tasks);
  const taskCacheInitialized = useTaskCacheStore((s) => s.initialized);
  const taskCacheLoading = useTaskCacheStore((s) => s.loading);
  const fetchAllTasks = useTaskCacheStore((s) => s.fetchAll);
  const fetchTaskUpdates = useTaskCacheStore((s) => s.fetchUpdates);
  const updateTaskLocally = useTaskCacheStore((s) => s.updateTaskLocally);
  const removeTaskLocally = useTaskCacheStore((s) => s.removeTaskLocally);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [initialDataLoading, setInitialDataLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useLocalStorageState<number | null>("selectedCategoryFilter", null);
  const [themeFilter, setThemeFilter] = useLocalStorageState<number | null>("selectedThemeFilter", null);
  const [priorityFilter, setPriorityFilter] = useState<Priority | null>(null);
  const [defaultTheme, setDefaultTheme] = useState<Theme | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  // const [showCompleteOverlay, setShowCompleteOverlay] = useState(false);

  // クイック追加用
  const [isQuickAdding, setIsQuickAdding] = useState(false);
  const [quickTaskTitle, setQuickTaskTitle] = useState("");

  // プログレスリング用ref
  const progressRingRef = useRef<HTMLDivElement>(null);

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

  // フィルターアコーディオン（デフォルトで閉じる）
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);

  // グローバル設定（activeMode, defaultCategoryId）
  const [globalSettings, setGlobalSettings] = useState<UserSettings | null>(
    null,
  );

  // fetchTasks: initial load uses full fetch, subsequent calls use incremental updates
  const fetchTasks = useCallback(async () => {
    if (taskCacheInitialized) {
      await fetchTaskUpdates();
    } else {
      await fetchAllTasks();
    }
  }, [taskCacheInitialized, fetchTaskUpdates, fetchAllTasks]);

  // フィルタリングとカウント処理を最適化
  const { filteredTasks, statusCounts, todayTasksCounts } = useFilteredTasks({
    tasks,
    filter,
    categoryFilter,
    themeFilter,
    priorityFilter,
    searchQuery: debouncedSearchQuery,
    themes,
  });

  // ソート処理を最適化
  const sortedTasks = useTaskSorting({
    tasks: filteredTasks,
    sortBy,
    sortOrder,
  });

  const completedTasksCount = todayTasksCounts.completed;
  const totalTasksCount = todayTasksCounts.total;

  const {
    particles,
    bursts,
    sweepingTaskId,
    colors,
    nextColors,
    triggerTaskCompletion,
    handleParticleArrive,
    handleBurstDone,
  } = useTaskCompletionAnimation(
    totalTasksCount,
    completedTasksCount,
    progressRingRef as React.RefObject<HTMLDivElement>,
  );

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${API_BASE}/categories`);
      const data = await res.json();
      setCategories(data);
      return data as Category[];
    } catch (e) {
      console.error(e);
      return [] as Category[];
    }
  };

  const fetchThemes = async () => {
    try {
      const res = await fetch(`${API_BASE}/themes`);
      const data = await res.json();
      setThemes(data);
      // グローバルデフォルトテーマを設定（クイック追加等で使用）
      const firstDefaultTheme = data.find((t: Theme) => t.isDefault);
      if (firstDefaultTheme) {
        setDefaultTheme(firstDefaultTheme);
      }
      // テーマフィルターが未設定の場合、カテゴリに応じたデフォルトテーマを選択
      if (themeFilter === null && categoryFilter !== null) {
        const themesInCategory = data.filter(
          (t: Theme) => t.categoryId === categoryFilter,
        );
        if (themesInCategory.length > 0) {
          const defaultInCategory = themesInCategory.find(
            (t: Theme) => t.isDefault,
          );
          const targetTheme = defaultInCategory || themesInCategory[0];
          setThemeFilter(targetTheme.id);
        }
      }
      return data;
    } catch (e) {
      console.error(e);
      return [];
    }
  };

  const updateStatus = async (
    id: number,
    status: Status,
    cardElement?: HTMLElement,
  ) => {
    const oldTask = tasks.find((t) => t.id === id);

    // タスクを完了にする場合、アニメーションをトリガー
    if (status === "done" && oldTask?.status !== "done" && cardElement) {
      const rect = cardElement.getBoundingClientRect();
      const x = rect.left + rect.width * 0.15;
      const y = rect.top + rect.height / 2;
      triggerTaskCompletion(id, x, y);
    }

    // Optimistic update
    updateTaskLocally(id, { status });

    try {
      const res = await fetch(`${API_BASE}/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("更新に失敗しました");
    } catch (e) {
      console.error(e);
      // Rollback on failure
      if (oldTask) {
        updateTaskLocally(id, { status: oldTask.status });
      }
    }
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
      for (const id of taskIds) {
        updateTaskLocally(id, { status: status as Status });
      }
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
      for (const id of taskIds) {
        removeTaskLocally(id);
      }
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

      // Ctrlキー（またはMacのCmdキー）との組み合わせをチェック
      if (e.ctrlKey || e.metaKey) {
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
        }
      } else if (e.key === "Escape") {
        if (isQuickAdding) {
          setIsQuickAdding(false);
          setQuickTaskTitle("");
        }
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [router, isQuickAdding, isSelectionMode]);

  const fetchGlobalSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      if (res.ok) {
        const data = await res.json();
        setGlobalSettings(data);
        return data as UserSettings;
      }
    } catch (e) {
      console.error("Failed to fetch global settings:", e);
    }
    return null;
  };

  useEffect(() => {
    // 初回読み込み時はすべてのデータを取得してからinitialDataLoadingを解除
    const initialLoad = async () => {
      setInitialDataLoading(true);
      // If cache is already initialized, use incremental fetch; otherwise full fetch
      const taskFetch = taskCacheInitialized
        ? fetchTaskUpdates()
        : fetchAllTasks();
      const [, , categoriesData, settings] = await Promise.all([
        taskFetch,
        fetchThemes(),
        fetchCategories(),
        fetchGlobalSettings(),
      ]);
      // カテゴリフィルタが未設定の場合はデフォルトカテゴリを適用
      if (categoryFilter === null) {
        if (settings?.defaultCategoryId) {
          setCategoryFilter(settings.defaultCategoryId);
        } else if (categoriesData && categoriesData.length > 0) {
          // defaultCategoryIdも未設定の場合は最初のカテゴリにフォールバック
          setCategoryFilter(categoriesData[0].id);
        }
      }
      setInitialDataLoading(false);
    };
    initialLoad();

    // ページがフォーカスを取得したときに差分のみ取得（ローディング表示なし）
    const handleFocus = () => {
      fetchTaskUpdates();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  // activeModeが変わったとき、現在のカテゴリフィルタが非表示になったら最初の表示カテゴリに切り替え
  useEffect(() => {
    if (categories.length === 0) return;
    const visibleCategories = categories.filter((cat) => {
      if (appMode === "all") return true;
      if (cat.mode === "both") return true;
      return cat.mode === appMode;
    });
    if (categoryFilter !== null) {
      const isVisible = visibleCategories.some((c) => c.id === categoryFilter);
      if (!isVisible && visibleCategories.length > 0) {
        const newCategoryId = visibleCategories[0].id;
        setCategoryFilter(newCategoryId);
        // テーマフィルタも調整
        const themesInCategory = themes.filter(
          (t) => t.categoryId === newCategoryId,
        );
        if (themesInCategory.length > 0) {
          const defaultInCategory = themesInCategory.find((t) => t.isDefault);
          const targetTheme = defaultInCategory || themesInCategory[0];
          setThemeFilter(targetTheme.id);
        } else {
          setThemeFilter(null);
        }
      }
    }
  }, [appMode, categories]);

  // フィルター変更時にページを1に戻す
  useEffect(() => {
    setCurrentPage(1);
  }, [filter, categoryFilter, themeFilter, priorityFilter, searchQuery]);

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
    <div className="h-[calc(100vh-4.2rem)] overflow-auto bg-background">
      <div className="mx-auto max-w-6xl px-4 py-4">
        {/* ヘッダー - タイトルとプログレスリング */}
        <div className="mb-4 flex items-center justify-between">
          {/* 左側: プログレスリングとタイトル */}
          <div className="flex items-center gap-4">
            {/* プログレスリング */}
            {totalTasksCount > 0 && (
              <ProgressRing
                completed={completedTasksCount}
                total={totalTasksCount}
                bursts={bursts}
                onBurstDone={handleBurstDone}
                ringRef={progressRingRef as React.RefObject<HTMLDivElement>}
                colors={colors}
              />
            )}
            <div>
              <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                本日のタスク
              </h1>
              <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                {totalTasksCount > 0
                  ? `${completedTasksCount} / ${totalTasksCount} 完了`
                  : "タスクが作成されていません"}
              </div>
            </div>
          </div>

          {/* 右側: アクションボタン */}
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
                        ? "bg-zinc-50 dark:bg-zinc-700/50 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400"
                        : status === "in-progress"
                          ? "bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                          : "bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 dark:text-green-400";

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
                    className={`px-3 py-1.5 rounded text-xs transition-all flex items-center gap-1.5 ${
                      isQuickAdding
                        ? "bg-green-500 dark:bg-green-600 text-white shadow-sm"
                        : "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/30"
                    }`}
                    title="クイック追加 (Ctrl+Q)"
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
                    className="px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/30 rounded text-xs transition-all flex items-center gap-1.5"
                    title="新規タスク (Ctrl+N)"
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
                        setSelectedTasks(
                          new Set(paginatedTasks.map((t) => t.id)),
                        );
                      }
                    }}
                    className={`px-3 py-1.5 rounded text-xs transition-all flex items-center gap-1.5 ${
                      selectedTasks.size === paginatedTasks.length &&
                      paginatedTasks.length > 0
                        ? "bg-blue-500 dark:bg-blue-600 text-white shadow-sm"
                        : "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/30"
                    }`}
                    title={
                      selectedTasks.size === paginatedTasks.length
                        ? "全解除"
                        : "全選択"
                    }
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      {selectedTasks.size === paginatedTasks.length &&
                      paginatedTasks.length > 0 ? (
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
                      {selectedTasks.size === paginatedTasks.length &&
                      paginatedTasks.length > 0
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
                className={`px-3 py-1.5 rounded text-xs transition-all flex items-center gap-1.5 ${
                  isSelectionMode
                    ? "bg-purple-500 dark:bg-purple-600 text-white shadow-sm"
                    : "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-900/30"
                }`}
                title="一括選択モード (Ctrl+S)"
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
                  {isSelectionMode ? `選択中 (${selectedTasks.size})` : "一括"}
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

        {/* クイック追加フォーム */}
        {isQuickAdding && (
          <div className="mb-4 p-3 bg-white dark:bg-indigo-dark-900 rounded-lg shadow-lg">
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
                className="text-sm px-2 flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
              <button
                onClick={handleQuickAdd}
                disabled={!quickTaskTitle.trim()}
                className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                作成
              </button>
            </div>
          </div>
        )}

        {/* 統合フィルターバー（アコーディオン） */}
        {!initialDataLoading && !isSelectionMode && !isQuickAdding && (
          <div className="mb-4 bg-white dark:bg-indigo-dark-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            {/* カテゴリタブ */}
            {categories.length > 0 && (
              <div className="flex items-center overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent">
                {categories
                  .filter((cat) => {
                    if (appMode === "all") return true;
                    if (cat.mode === "both") return true;
                    return cat.mode === appMode;
                  })
                  .map((cat) => {
                    const CatIcon =
                      getIconComponent(cat.icon || "") || FolderKanban;
                    const isActive = categoryFilter === cat.id;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => {
                          setCategoryFilter(cat.id);
                          const themesInCategory = themes.filter(
                            (t) => t.categoryId === cat.id,
                          );
                          if (themesInCategory.length === 0) {
                            setThemeFilter(null);
                          } else {
                            const currentThemeInCategory =
                              themesInCategory.find(
                                (t) => t.id === themeFilter,
                              );
                            if (!currentThemeInCategory) {
                              const defaultInCategory = themesInCategory.find(
                                (t) => t.isDefault,
                              );
                              const targetTheme =
                                defaultInCategory || themesInCategory[0];
                              setThemeFilter(targetTheme.id);
                            }
                          }
                        }}
                        className={`relative flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-all whitespace-nowrap shrink-0 border-b-2 ${
                          isActive
                            ? "bg-black/5 dark:bg-white/5"
                            : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-black/2 dark:hover:bg-white/2 border-transparent"
                        }`}
                        style={{
                          borderBottomColor: isActive ? cat.color : undefined,
                          color: isActive ? cat.color : undefined,
                        }}
                      >
                        <CatIcon className="w-3.5 h-3.5" />
                        {cat.name}
                        {globalSettings?.defaultCategoryId === cat.id && (
                          <Star className="w-2.5 h-2.5 fill-current" />
                        )}
                      </button>
                    );
                  })}
              </div>
            )}

            {/* カテゴリとテーマの区切り線 */}
            {categories.length > 0 && (
              <div className="mx-3">
                <div className="border-t border-zinc-100 dark:border-zinc-800/80"></div>
              </div>
            )}

            {/* テーマタブ */}
            <div className="flex items-center gap-2 px-1 py-1.5">
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent flex-1">
                {(() => {
                  const filteredThemes = themes.filter((theme) => {
                    if (categoryFilter === null) return true;
                    return theme.categoryId === categoryFilter;
                  });
                  if (filteredThemes.length === 0 && categoryFilter !== null) {
                    return (
                      <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 py-0.5 px-1">
                        <span>このカテゴリにはテーマがありません。</span>
                        <button
                          onClick={() => router.push("/themes")}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                          テーマを追加
                        </button>
                      </div>
                    );
                  }
                  return filteredThemes.map((theme) => {
                    const IconComponent =
                      getIconComponent(theme.icon || "") || SwatchBook;
                    const isActive = themeFilter === theme.id;
                    return (
                      <button
                        key={theme.id}
                        onClick={() => {
                          setThemeFilter(theme.id);
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                          isActive
                            ? "shadow-sm"
                            : "border border-zinc-300 dark:border-zinc-700 hover:border-current"
                        }`}
                        style={{
                          backgroundColor: isActive ? theme.color : undefined,
                          color: isActive ? "#ffffff" : theme.color,
                        }}
                      >
                        <IconComponent className="w-3.5 h-3.5" />
                        {theme.name}
                        {theme.isDefault && (
                          <Star className="w-2.5 h-2.5 fill-current" />
                        )}
                      </button>
                    );
                  });
                })()}
              </div>

              {/* アコーディオントグル */}
              <button
                onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all shrink-0 ${
                  isFilterExpanded
                    ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}
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
                    d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                  />
                </svg>
                <span className="hidden sm:inline">フィルター</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${isFilterExpanded ? "rotate-180" : ""}`}
                />
              </button>
            </div>

            {/* フィルター・ソート（アコーディオンコンテンツ） */}
            <div
              className={`overflow-hidden transition-all duration-300 ease-out ${
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
                        all: { label: "すべて", color: "theme" },
                        todo: { label: "未着手", color: "zinc" },
                        "in-progress": { label: "進行中", color: "blue" },
                        done: { label: "完了", color: "green" },
                      };
                      const config =
                        statusConfigLocal[
                          status as keyof typeof statusConfigLocal
                        ];
                      const count = statusCounts[status] || 0;

                      return (
                        <button
                          key={status}
                          onClick={() => setFilter(status)}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-all duration-200 ${
                            filter === status
                              ? config.color === "theme"
                                ? "text-white shadow-md"
                                : config.color === "blue"
                                  ? "bg-blue-600 text-white shadow-md"
                                  : config.color === "green"
                                    ? "bg-green-600 text-white shadow-md"
                                    : "bg-zinc-600 text-white shadow-md"
                              : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700"
                          }`}
                          style={{
                            backgroundColor:
                              filter === status && config.color === "theme"
                                ? "#6366F1"
                                : undefined,
                          }}
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
                  <div className="flex items-center gap-1">
                    {[
                      {
                        value: "",
                        label: "すべて",
                        icon: null,
                        iconColor: "",
                        bgColor: "",
                        isThemeColor: true,
                      },
                      {
                        value: "urgent",
                        label: "緊急",
                        icon: <ChevronsUp className="w-3.5 h-3.5" />,
                        iconColor: "text-red-500",
                        bgColor: "bg-red-500",
                      },
                      {
                        value: "high",
                        label: "高",
                        icon: <ChevronUp className="w-3.5 h-3.5" />,
                        iconColor: "text-orange-500",
                        bgColor: "bg-orange-500",
                      },
                      {
                        value: "medium",
                        label: "中",
                        icon: <ChevronsUpDown className="w-3.5 h-3.5" />,
                        iconColor: "text-blue-500",
                        bgColor: "bg-blue-500",
                      },
                      {
                        value: "low",
                        label: "低",
                        icon: <ChevronDown className="w-3.5 h-3.5" />,
                        iconColor: "text-zinc-400",
                        bgColor: "bg-zinc-500",
                      },
                    ].map((priority) => (
                      <button
                        key={priority.value}
                        onClick={() =>
                          setPriorityFilter(
                            priority.value
                              ? (priority.value as Priority)
                              : null,
                          )
                        }
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap focus:outline-none focus-visible:outline-none focus-visible:ring-0 ${
                          (priorityFilter || "") === priority.value
                            ? `${priority.bgColor} text-white shadow-md`
                            : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700"
                        }`}
                        style={{
                          backgroundColor:
                            (priorityFilter || "") === priority.value &&
                            "isThemeColor" in priority &&
                            priority.isThemeColor
                              ? "#6366F1"
                              : undefined,
                        }}
                      >
                        {priority.icon && (
                          <span
                            className={
                              (priorityFilter || "") === priority.value
                                ? "text-white"
                                : priority.iconColor
                            }
                          >
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
                    className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 text-zinc-700 dark:text-zinc-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 whitespace-nowrap"
                  >
                    <option value="createdAt">作成日時</option>
                    <option value="title">タイトル</option>
                    <option value="priority">優先度</option>
                  </select>
                  <button
                    onClick={() =>
                      setSortOrder((o) => (o === "asc" ? "desc" : "asc"))
                    }
                    className="p-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-0"
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

        {initialDataLoading ? (
          <div className="animate-pulse space-y-4">
            {/* 統合フィルターUIスケルトン（アコーディオン） */}
            <div className="bg-white dark:bg-indigo-dark-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
              {/* テーマ選択スケルトン */}
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="flex items-center gap-2 flex-1">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-8 w-20 bg-zinc-200 dark:bg-zinc-700 rounded-lg"
                    />
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
                  className="bg-white dark:bg-indigo-dark-900 rounded-lg p-4 shadow-sm border border-zinc-200 dark:border-zinc-800"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 bg-zinc-200 dark:bg-zinc-700 rounded-md shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-5 w-3/4 bg-zinc-200 dark:bg-zinc-700 rounded" />
                      <div className="h-4 w-1/2 bg-zinc-200 dark:bg-zinc-700 rounded" />
                    </div>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3].map((j) => (
                        <div
                          key={j}
                          className="h-7 w-7 bg-zinc-200 dark:bg-zinc-700 rounded-md"
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : taskCacheLoading && !taskCacheInitialized ? (
          // タスクデータが初回読み込み中の場合は追加でローディング表示
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-zinc-500 dark:text-zinc-400">
              タスク一覧を読み込み中...
            </p>
          </div>
        ) : sortedTasks.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 dark:text-zinc-400">
            {/* カテゴリにテーマがない場合 */}
            {categoryFilter !== null &&
            themes.filter((t) => t.categoryId === categoryFilter).length ===
              0 ? (
              <>
                <SwatchBook className="w-16 h-16 mx-auto mb-4 text-zinc-300 dark:text-zinc-700" />
                <p className="text-lg font-medium mb-2">
                  テーマが登録されていません
                </p>
                <p className="text-sm mb-4">
                  このカテゴリにテーマを追加して、タスクを整理しましょう
                </p>
                <button
                  onClick={() => router.push("/themes")}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium transition-colors inline-flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  テーマを追加
                </button>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        ) : (
          <>
            {/* タスクデータが読み込み中の場合は追加で読み込み中表示を表示しつつ、既存データがあれば併用表示 */}
            {taskCacheLoading && taskCacheInitialized && (
              <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                  <span className="text-sm text-blue-700 dark:text-blue-300">
                    タスクデータを更新中...
                  </span>
                </div>
              </div>
            )}

            <div className="grid gap-3">
              {paginatedTasks.map((task, index) => (
                <div
                  key={task.id}
                  className="slide-in-bottom"
                  style={{
                    animationDelay: `${index * 0.02}s`,
                    animationFillMode: "both",
                  }}
                >
                  <TaskCard
                    task={task}
                    isSelected={selectedTasks.has(task.id)}
                    isSelectionMode={isSelectionMode}
                    onTaskClick={openTaskPanel}
                    onStatusChange={(
                      taskId: number,
                      status: Status,
                      cardElement?: HTMLElement,
                    ) => {
                      updateStatus(taskId, status, cardElement);
                    }}
                    onToggleSelect={toggleTaskSelection}
                    onTaskUpdated={fetchTasks}
                    onOpenInPage={openTaskInPage}
                    sweepingTaskId={sweepingTaskId}
                  />
                </div>
              ))}
            </div>

            {/* ページネーション */}
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              itemsPerPage={itemsPerPage}
              onPageChange={setCurrentPage}
              onItemsPerPageChange={setItemsPerPage}
            />
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

      {/* <TaskCompleteOverlay
        show={showCompleteOverlay}
        onComplete={() => setShowCompleteOverlay(false)}
      /> */}

      {/* 飛翔する粒子 */}
      {particles.map((p) => (
        <FlyingParticle
          key={p.id}
          startX={p.startX}
          startY={p.startY}
          targetX={p.targetX}
          targetY={p.targetY}
          colors={nextColors}
          onArrive={handleParticleArrive}
        />
      ))}
    </div>
  );
}
