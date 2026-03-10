'use client';
import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type {
  Theme,
  Category,
  Priority,
  Status,
  UserSettings,
  Task,
} from '@/types';
import TaskSlidePanel from '@/feature/tasks/components/TaskSlidePanel';
import TaskCard from '@/feature/tasks/components/TaskCard';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { useTaskDetailVisibilityStore } from '@/stores/taskDetailVisibilityStore';
import Pagination from '@/components/ui/pagination/Pagination';
import {
  statusConfig,
  renderStatusIcon,
} from '@/feature/tasks/config/StatusConfig';
import { priorityConfig } from '@/feature/tasks/components/PriorityIcon';
import {
  SwatchBook,
  Star,
  ChevronDown,
  FolderKanban,
  Plus,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { getIconComponent } from '@/components/category/IconData';
import { API_BASE_URL } from '@/utils/api';
import { apiFetch } from '@/lib/api-client';
import { fetchTaskStatistics } from '@/lib/task-api';
import { useExecutingTasksPolling } from '@/hooks/useExecutingTasksPolling';
import TodayTaskProgressBar from '@/components/TodayTaskProgressBar';
import { useAppModeStore } from '@/stores/appModeStore';
import { useTaskCacheStore } from '@/stores/taskCacheStore';
import { useExecutionStateStore } from '@/stores/executionStateStore';
import { useTaskCompletionAnimation } from '@/feature/tasks/components/TaskCompletionAnimation';
import { useFilteredTasks } from '@/hooks/useFilteredTasks';
import { useTaskSorting } from '@/hooks/useTaskSorting';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { useDebounce } from '@/hooks/useDebounce';
import { useTaskAutoSync } from '@/hooks/useTaskAutoSync';
import { requireAuth } from '@/contexts/AuthContext';
import { useFilterDataStore } from '@/stores/filterDataStore';
import { useTranslations } from 'next-intl';
import {
  TaskCardsSkeleton,
  EnhancedSkeletonBlock,
} from '@/components/ui/LoadingSpinner';
import { createLogger } from '@/lib/logger';

const logger = createLogger('HomeClient');
const API_BASE = API_BASE_URL;

function HomeClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get('search') || '';
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const { showToast } = useToast();
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const { showTaskDetail, hideTaskDetail } = useTaskDetailVisibilityStore();
  const appMode = useAppModeStore((state) => state.mode);
  const tasks = useTaskCacheStore((s) => s.tasks);
  const taskCacheInitialized = useTaskCacheStore((s) => s.initialized);
  const taskCacheLoading = useTaskCacheStore((s) => s.loading);
  const fetchAllTasks = useTaskCacheStore((s) => s.fetchAll);
  const fetchTaskUpdates = useTaskCacheStore((s) => s.fetchUpdates);
  const updateTaskLocally = useTaskCacheStore((s) => s.updateTaskLocally);
  const removeTaskLocally = useTaskCacheStore((s) => s.removeTaskLocally);
  const executingTasksSize = useExecutionStateStore(
    (s) => s.executingTasks.size,
  );
  // フィルターデータストアから状態を取得
  const {
    categories,
    themes,
    isLoading: filtersLoading,
    isInitialized: filtersInitialized,
    error: filtersError,
    initializeData: initializeFilterData,
    refreshData: refreshFilterData,
    shouldBackgroundRefresh,
    backgroundRefresh,
  } = useFilterDataStore();
  const [filter, setFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useLocalStorageState<
    number | null
  >('selectedCategoryFilter', null);
  const [themeFilter, setThemeFilter] = useLocalStorageState<number | null>(
    'selectedThemeFilter',
    null,
  );
  const [priorityFilter, setPriorityFilter] = useState<Priority | null>(null);
  const [defaultTheme, setDefaultTheme] = useState<Theme | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  // const [showCompleteOverlay, setShowCompleteOverlay] = useState(false);

  // クイック追加用
  const [isQuickAdding, setIsQuickAdding] = useState(false);
  const [quickTaskTitle, setQuickTaskTitle] = useState('');

  // プログレスリング用ref
  const progressRingRef = useRef<HTMLDivElement>(null);

  // テーマスクロール制御用
  const themeScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isScrollNeeded, setIsScrollNeeded] = useState(false);

  // ソート
  const [sortBy, setSortBy] = useState<'createdAt' | 'priority' | 'title'>(
    'createdAt',
  );
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // 複数選択
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  // ページネーション
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // フィルターアコーディオン（状態を永続化）
  const [isFilterExpanded, setIsFilterExpanded] = useLocalStorageState<boolean>(
    'isFilterExpanded',
    false,
  );

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

  // 自動同期を有効化（30秒ごと、サイレントモード）
  // AIエージェント実行中は、useExecutingTasksPollingが5秒ごとに更新するので重複を避ける
  useTaskAutoSync({
    enabled: true,
    interval: 30000, // 30秒
    silent: true,
    skipDuringExecution: true, // AIエージェント実行中はスキップ
  });

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

  const isTodayTask = useCallback((task?: Task | null) => {
    if (!task) return false;
    if (task.parentId) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const taskDate = new Date(task.createdAt);
    taskDate.setHours(0, 0, 0, 0);

    return taskDate.getTime() === today.getTime();
  }, []);

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

  // テーマ関連の初期設定を行う関数（データ取得は filterDataStore が担当）
  const setupThemeDefaults = useCallback(() => {
    if (themes.length === 0) return;

    // グローバルデフォルトテーマを設定（クイック追加等で使用）
    const firstDefaultTheme = themes.find((t: Theme) => t.isDefault);
    if (firstDefaultTheme) {
      setDefaultTheme(firstDefaultTheme);
    }

    // テーマフィルターが未設定の場合、カテゴリに応じたデフォルトテーマを選択
    if (themeFilter === null && categoryFilter !== null) {
      const themesInCategory = themes.filter(
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
  }, [themes, categoryFilter, themeFilter, setThemeFilter]);

  const updateStatus = async (
    id: number,
    status: Status,
    cardElement?: HTMLElement,
  ) => {
    const oldTask = tasks.find((t) => t.id === id);

    // タスクを完了にする場合、アニメーションをトリガー（本日のタスクのみ、かつテーマがある場合）
    const hasThemesInCategory =
      categoryFilter === null ||
      themes.filter((t) => t.categoryId === categoryFilter).length > 0;
    if (
      status === 'done' &&
      oldTask?.status !== 'done' &&
      cardElement &&
      isTodayTask(oldTask) &&
      hasThemesInCategory
    ) {
      const rect = cardElement.getBoundingClientRect();
      const x = rect.left + rect.width * 0.15;
      const y = rect.top + rect.height / 2;
      triggerTaskCompletion(id, x, y);
    }

    // Optimistic update
    updateTaskLocally(id, { status });

    try {
      const res = await fetch(`${API_BASE}/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(t('updateFailed'));
    } catch (e) {
      logger.error(e);
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
      await apiFetch('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: quickTaskTitle,
          status: 'todo',
          priority: 'medium',
          ...(themeFilter && { themeId: themeFilter }),
          ...(!themeFilter && defaultTheme && { themeId: defaultTheme.id }),
        }),
        skipCache: true, // POSTリクエストはキャッシュスキップ
      });

      setQuickTaskTitle('');
      setIsQuickAdding(false);
      showToast(t('taskCreated'), 'success');
      // サーバーから最新データを再取得（theme情報を含む）
      await fetchTasks();
    } catch (e) {
      logger.error(e);
      showToast(t('createFailed'), 'error');
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
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
          }),
        ),
      );
      for (const id of taskIds) {
        updateTaskLocally(id, { status: status as Status });
      }
      showToast(`${taskIds.length}${t('bulkUpdated')}`, 'success');
      setSelectedTasks(new Set());
      setIsSelectionMode(false);
    } catch {
      showToast(t('bulkUpdateFailed'), 'error');
    }
  };

  const bulkDelete = async () => {
    if (!confirm(t('bulkDeleteConfirm', { count: selectedTasks.size }))) return;

    const taskIds = Array.from(selectedTasks);
    try {
      await Promise.all(
        taskIds.map((id) =>
          fetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE' }),
        ),
      );
      for (const id of taskIds) {
        removeTaskLocally(id);
      }
      showToast(`${taskIds.length}${t('bulkDeleted')}`, 'success');
      setSelectedTasks(new Set());
      setIsSelectionMode(false);
    } catch {
      showToast(t('bulkDeleteFailed'), 'error');
    }
  };

  // テーマスクロール制御関数
  const checkThemeScrollPosition = useCallback(() => {
    const scrollElement = themeScrollRef.current;
    if (!scrollElement) {
      // 要素が見つからない場合は状態をリセット
      setIsScrollNeeded(false);
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }

    const { scrollLeft, scrollWidth, clientWidth } = scrollElement;
    const needsScroll = scrollWidth > clientWidth;

    setIsScrollNeeded(needsScroll);
    setCanScrollLeft(needsScroll && scrollLeft > 0);
    setCanScrollRight(
      needsScroll && scrollLeft < scrollWidth - clientWidth - 1,
    );
  }, []);

  const scrollThemeLeft = useCallback(() => {
    const scrollElement = themeScrollRef.current;
    if (!scrollElement) return;

    scrollElement.scrollBy({
      left: -200,
      behavior: 'smooth',
    });
  }, []);

  const scrollThemeRight = useCallback(() => {
    const scrollElement = themeScrollRef.current;
    if (!scrollElement) return;

    scrollElement.scrollBy({
      left: 200,
      behavior: 'smooth',
    });
  }, []);

  // テーマ変更時にスクロール位置をチェック
  useEffect(() => {
    // データ読み込み後のDOM更新を待つため少し遅延させる
    const timeoutId = setTimeout(() => {
      checkThemeScrollPosition();
    }, 0);

    const scrollElement = themeScrollRef.current;
    if (scrollElement) {
      const handleScroll = () => checkThemeScrollPosition();
      scrollElement.addEventListener('scroll', handleScroll);

      // ResizeObserverでサイズ変更も監視
      const resizeObserver = new ResizeObserver(() =>
        checkThemeScrollPosition(),
      );
      resizeObserver.observe(scrollElement);

      return () => {
        clearTimeout(timeoutId);
        scrollElement.removeEventListener('scroll', handleScroll);
        resizeObserver.disconnect();
      };
    }

    return () => clearTimeout(timeoutId);
  }, [themes, categoryFilter, checkThemeScrollPosition]);

  // テーマの数が変更された時の追加チェック（データ読み込み完了対応）
  useEffect(() => {
    if (themes.length > 0) {
      // DOM更新後に確実にチェック
      const timeoutId = setTimeout(() => {
        checkThemeScrollPosition();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [themes.length, checkThemeScrollPosition]);

  // コンポーネントマウント完了後の遅延チェック（ページ遷移対応）
  useEffect(() => {
    // マウント後少し時間をおいて確実にチェック
    const timeoutId = setTimeout(() => {
      checkThemeScrollPosition();
    }, 200);
    return () => clearTimeout(timeoutId);
  }, [checkThemeScrollPosition]);

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
          case 'n':
            e.preventDefault();
            const themeParam = themeFilter || defaultTheme?.id;
            router.push(
              `/tasks/new${themeParam ? `?themeId=${themeParam}` : ''}`,
            );
            break;
          case 'q':
            e.preventDefault();
            setIsQuickAdding(true);
            break;
          case 's':
            e.preventDefault();
            setIsSelectionMode((prev) => !prev);
            if (isSelectionMode) {
              setSelectedTasks(new Set());
            }
            break;
        }
      } else if (e.key === 'Escape') {
        if (isQuickAdding) {
          setIsQuickAdding(false);
          setQuickTaskTitle('');
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [router, isQuickAdding, isSelectionMode, defaultTheme?.id, themeFilter]);

  const fetchGlobalSettings = async () => {
    try {
      const data = await apiFetch<UserSettings>('/settings', {
        cacheTime: 300000,
      }); // 5分キャッシュ
      setGlobalSettings(data);
      return data;
    } catch (e) {
      logger.transientError('Failed to fetch global settings:', e);
    }
    return null;
  };

  // 初回読み込みフラグを追加
  const [hasInitialized, setHasInitialized] = useState(false);

  useEffect(() => {
    // 初回読み込み時のみ実行
    if (hasInitialized) return;

    const initialLoad = async () => {
      // 並列リクエストを最適化
      const requests = {
        tasks: taskCacheInitialized ? fetchTaskUpdates() : fetchAllTasks(),
        filterData: initializeFilterData(),
        settings: fetchGlobalSettings(),
        statistics: fetchTaskStatistics(),
      };

      // タイムアウト付きで初回ロード（ゾンビソケット等でAPIが応答しない場合の対策）
      const INITIAL_LOAD_TIMEOUT = 15000; // 15秒
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Initial data load timed out')),
          INITIAL_LOAD_TIMEOUT,
        ),
      );

      let results: PromiseSettledResult<unknown>[];
      try {
        results = (await Promise.race([
          Promise.allSettled(Object.values(requests)),
          timeoutPromise,
        ])) as PromiseSettledResult<unknown>[];
      } catch {
        logger.warn(
          'Initial data load timed out after 15s - API may be unreachable',
        );
        results = Object.values(requests).map(() => ({
          status: 'rejected' as const,
          reason: new Error('timeout'),
        }));
      }

      const [taskResult, filterDataResult, settingsResult, statsResult] =
        results;

      const settings =
        settingsResult.status === 'fulfilled'
          ? (settingsResult.value as UserSettings)
          : null;

      // カテゴリフィルタが未設定の場合はデフォルトカテゴリを適用
      if (categoryFilter === null) {
        if (settings?.defaultCategoryId) {
          setCategoryFilter(settings.defaultCategoryId);
        } else if (categories && categories.length > 0) {
          // defaultCategoryIdも未設定の場合は最初のカテゴリにフォールバック
          setCategoryFilter(categories[0].id);
        }
      }
      setHasInitialized(true);
    };
    initialLoad();
  }, []); // 依存配列を空にして初回のみ実行

  // テーマデータが更新された時にデフォルト設定を実行
  useEffect(() => {
    if (themes.length > 0) {
      setupThemeDefaults();
    }
  }, [themes, setupThemeDefaults]);

  // バックグラウンド更新チェック（5分ごと）
  useEffect(() => {
    const checkBackgroundRefresh = () => {
      if (shouldBackgroundRefresh()) {
        logger.debug('[HomeClient] Triggering background filter data refresh');
        backgroundRefresh();
      }
    };

    // 初回チェック（1分後）
    const initialTimeout = setTimeout(checkBackgroundRefresh, 60000);

    // 定期チェック（5分ごと）
    const interval = setInterval(checkBackgroundRefresh, 5 * 60 * 1000);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [shouldBackgroundRefresh, backgroundRefresh]);

  // フィルタリング計算の最適化
  const visibleCategories = useMemo(() => {
    return categories.filter((cat) => {
      if (appMode === 'all') return true;
      if (cat.mode === 'both') return true;
      return cat.mode === appMode;
    });
  }, [categories, appMode]);

  const visibleThemes = useMemo(() => {
    if (categoryFilter === null) return themes;
    return themes.filter((theme) => theme.categoryId === categoryFilter);
  }, [themes, categoryFilter]);

  // フィルタースケルトン・エラー表示コンポーネント
  const FilterSkeleton = () => (
    <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm transition-all duration-300 mb-4 animate-skeleton-fade-in">
      {/* カテゴリタブ（水平スクロール） */}
      <div className="flex items-center overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600 scrollbar-track-transparent bg-slate-50 dark:bg-slate-800/50">
        <div className="flex gap-2 px-3 py-2 min-w-max">
          <EnhancedSkeletonBlock className="w-16 h-6 rounded-md" delay={0} />
          <EnhancedSkeletonBlock className="w-20 h-6 rounded-md" delay={100} />
          <EnhancedSkeletonBlock className="w-12 h-6 rounded-md" delay={200} />
          <EnhancedSkeletonBlock className="w-18 h-6 rounded-md" delay={300} />
          <EnhancedSkeletonBlock className="w-14 h-6 rounded-md" delay={400} />
        </div>
      </div>

      {/* テーマタブ */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600 scrollbar-track-transparent flex-1">
          <EnhancedSkeletonBlock className="w-12 h-5 rounded-sm" delay={100} />
          <EnhancedSkeletonBlock className="w-16 h-5 rounded-sm" delay={200} />
          <EnhancedSkeletonBlock className="w-10 h-5 rounded-sm" delay={300} />
          <EnhancedSkeletonBlock className="w-14 h-5 rounded-sm" delay={400} />
        </div>
        <EnhancedSkeletonBlock
          className="w-12 h-6 rounded shrink-0"
          delay={500}
        />
      </div>
    </div>
  );

  // フィルターエラー表示コンポーネント
  const FilterError = ({ error }: { error: string }) => (
    <div className="relative overflow-hidden border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 shadow-sm transition-all duration-300 mb-4">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="text-red-600 dark:text-red-400">⚠️</div>
          <span className="text-sm text-red-700 dark:text-red-300">
            {t('filterDataFailed')}
            {error}
          </span>
        </div>
        <button
          onClick={() => refreshFilterData(true)}
          className="px-3 py-1 text-xs bg-red-100 dark:bg-red-800 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-700 transition-colors"
        >
          {t('retry')}
        </button>
      </div>
    </div>
  );

  // activeModeが変わったとき、現在のカテゴリフィルタが非表示になったら最初の表示カテゴリに切り替え
  useEffect(() => {
    if (visibleCategories.length === 0) return;

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
  }, [visibleCategories, categoryFilter, themes, setThemeFilter]);

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
            {/* Progress Bar - Compact Version */}
            <TodayTaskProgressBar
              completedCount={completedTasksCount}
              totalCount={totalTasksCount}
              compact={true}
              className="w-52"
            />
          </div>

          {/* 右側: アクションボタン */}
          <div className="flex items-center gap-3">
            {/* バルク操作ボタン（選択時のみ表示） */}
            {isSelectionMode && selectedTasks.size > 0 && (
              <>
                {/* ステータス変更ボタングループ */}
                <div className="relative flex items-center gap-1 px-3 py-1 bg-white dark:bg-slate-900/50 rounded-lg border border-slate-300 dark:border-slate-700 shadow-sm">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 mr-2">
                    CHANGE STATUS:
                  </span>
                  {['todo', 'in-progress', 'done'].map((status, idx) => {
                    const config =
                      statusConfig[status as keyof typeof statusConfig];
                    const textColorClasses =
                      status === 'todo'
                        ? 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                        : status === 'in-progress'
                          ? 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300'
                          : 'text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300';

                    const bgHoverClasses =
                      status === 'todo'
                        ? 'hover:bg-zinc-100 dark:hover:bg-zinc-900/30'
                        : status === 'in-progress'
                          ? 'hover:bg-blue-100 dark:hover:bg-blue-900/30'
                          : 'hover:bg-green-100 dark:hover:bg-green-900/30';

                    return (
                      <React.Fragment key={status}>
                        {idx > 0 && (
                          <div className="w-px h-5 bg-slate-300 dark:bg-slate-600" />
                        )}
                        <button
                          onClick={() => bulkUpdateStatus(status)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition-all cursor-pointer ${textColorClasses} ${bgHoverClasses}`}
                          title={t('changeToStatus', { status: config.label })}
                        >
                          <span className="w-3.5 h-3.5">
                            {renderStatusIcon(status)}
                          </span>
                          <span className="font-mono text-xs font-black tracking-tight">
                            {config.label}
                          </span>
                        </button>
                      </React.Fragment>
                    );
                  })}
                </div>
              </>
            )}

            {/* メインアクションボタン */}
            <div className="flex items-center gap-2">
              {!isSelectionMode && (
                <>
                  {/* クイックボタン */}
                  <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-green-500 dark:hover:border-green-400">
                    <button
                      onClick={() => setIsQuickAdding(!isQuickAdding)}
                      className={`flex items-center gap-2 transition-all cursor-pointer ${
                        isQuickAdding
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300'
                      }`}
                      title={`${t('quickAdd')} (Ctrl+Q)`}
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
                      <span className="font-mono text-xs font-black tracking-tight">
                        {t('quickAdd')}
                      </span>
                    </button>
                  </div>

                  {/* 新規ボタン */}
                  <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-blue-500 dark:hover:border-blue-400">
                    <button
                      onClick={() => {
                        const themeParam = themeFilter || defaultTheme?.id;
                        router.push(
                          `/tasks/new${themeParam ? `?themeId=${themeParam}` : ''}`,
                        );
                      }}
                      className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-all cursor-pointer"
                      title={`${t('newTask')} (Ctrl+N)`}
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
                      <span className="font-mono text-xs font-black tracking-tight">
                        {t('newTask')}
                      </span>
                    </button>
                  </div>
                </>
              )}

              {/* 選択モード時のアクションボタン */}
              {isSelectionMode && (
                <>
                  {/* 全選択/全解除ボタン */}
                  <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-slate-500 dark:hover:border-slate-400">
                    <button
                      onClick={() => {
                        if (selectedTasks.size === paginatedTasks.length) {
                          setSelectedTasks(new Set());
                          setIsSelectionMode(false);
                        } else {
                          setSelectedTasks(
                            new Set(paginatedTasks.map((t) => t.id)),
                          );
                        }
                      }}
                      className={`flex items-center gap-2 transition-all cursor-pointer ${
                        selectedTasks.size === paginatedTasks.length &&
                        paginatedTasks.length > 0
                          ? 'text-slate-600 dark:text-slate-400'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                      }`}
                      title={
                        selectedTasks.size === paginatedTasks.length
                          ? t('deselectAndExit')
                          : t('selectAll')
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
                      <span className="font-mono text-xs font-black tracking-tight">
                        {selectedTasks.size === paginatedTasks.length &&
                        paginatedTasks.length > 0
                          ? t('deselectAll')
                          : t('selectAll')}
                      </span>
                    </button>
                  </div>

                  {/* 削除ボタン（選択されたタスクがある場合のみ表示） */}
                  {selectedTasks.size > 0 && (
                    <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-red-500 dark:hover:border-red-400">
                      <button
                        onClick={bulkDelete}
                        className="flex items-center gap-2 transition-all cursor-pointer text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                        title={t('deleteSelected')}
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
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                        <span className="font-mono text-xs font-black tracking-tight">
                          {tc('delete')}
                        </span>
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* 一括ボタン */}
              <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-purple-500 dark:hover:border-purple-400">
                <button
                  onClick={() => {
                    setIsSelectionMode(!isSelectionMode);
                    setSelectedTasks(new Set());
                  }}
                  className={`flex items-center gap-2 transition-all cursor-pointer ${
                    isSelectionMode
                      ? 'text-purple-600 dark:text-purple-400'
                      : 'text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300'
                  }`}
                  title={t('bulkSelectionMode')}
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
                  <span className="font-mono text-xs font-black tracking-tight">
                    {isSelectionMode
                      ? t('selecting', { count: selectedTasks.size })
                      : t('bulk')}
                  </span>
                </button>
              </div>
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
                  if (e.key === 'Enter') handleQuickAdd();
                  if (e.key === 'Escape') {
                    setIsQuickAdding(false);
                    setQuickTaskTitle('');
                  }
                }}
                placeholder={t('taskTitlePlaceholder')}
                className="text-sm px-2 flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
              <button
                onClick={handleQuickAdd}
                disabled={!quickTaskTitle.trim()}
                className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {tc('create')}
              </button>
            </div>
          </div>
        )}

        {/* 統合フィルターバー（アコーディオン） - 一括選択モード時は非表示 */}
        {!isSelectionMode &&
          (filtersError ? (
            <FilterError error={filtersError} />
          ) : filtersLoading ? (
            <FilterSkeleton />
          ) : categories.length > 0 ? (
            <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm transition-all duration-300 hover:border-amber-500/50 mb-4">
              {/* カテゴリタブ */}
              {categories.length > 0 && (
                <div className="flex items-center overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600 scrollbar-track-transparent bg-slate-50 dark:bg-slate-800/50">
                  {categories
                    .filter((cat) => {
                      if (appMode === 'all') return true;
                      if (cat.mode === 'both') return true;
                      return cat.mode === appMode;
                    })
                    .map((cat) => {
                      const CatIcon =
                        getIconComponent(cat.icon || '') || FolderKanban;
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
                          className={`relative flex items-center gap-1.5 px-4 py-2 font-mono text-[11px] uppercase tracking-wider transition-all whitespace-nowrap shrink-0 border-r ${
                            isActive
                              ? 'bg-slate-200 dark:bg-slate-600/70 font-bold border-b-2'
                              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/30'
                          } border-slate-200 dark:border-slate-700`}
                          style={{
                            color: isActive ? cat.color : undefined,
                            borderBottomColor: isActive ? cat.color : undefined,
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

              {/* テーマタブ */}
              <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-200 dark:border-slate-700">
                {/* 左スクロールボタン */}
                {isScrollNeeded && (
                  <button
                    onClick={scrollThemeLeft}
                    disabled={!canScrollLeft}
                    className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-lg transition-all ${
                      canScrollLeft
                        ? 'bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300'
                        : 'bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                    }`}
                    aria-label={t('scrollLeft')}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                )}

                <div
                  ref={themeScrollRef}
                  className="flex items-center gap-2 overflow-x-auto scroll-smooth flex-1 theme-scroll-hidden"
                >
                  {(() => {
                    const filteredThemes = themes.filter((theme) => {
                      if (categoryFilter === null) return true;
                      return theme.categoryId === categoryFilter;
                    });
                    if (
                      filteredThemes.length === 0 &&
                      categoryFilter !== null
                    ) {
                      return (
                        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 py-1 px-1">
                          <span>NO_THEMES_FOUND</span>
                          <button
                            onClick={() => router.push('/themes')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded font-mono text-[10px] uppercase tracking-wider bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-500/30 transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                            ADD_THEME
                          </button>
                        </div>
                      );
                    }
                    return filteredThemes.map((theme) => {
                      const IconComponent =
                        getIconComponent(theme.icon || '') || SwatchBook;
                      const isActive = themeFilter === theme.id;
                      return (
                        <button
                          key={theme.id}
                          onClick={() => {
                            setThemeFilter(theme.id);
                          }}
                          className={`flex items-center gap-1.5 px-3 py-1.5 font-medium text-xs transition-all whitespace-nowrap shrink-0 rounded-sm ${
                            isActive
                              ? 'shadow-lg font-bold text-white dark:text-white'
                              : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'
                          }`}
                          style={{
                            backgroundColor: isActive ? theme.color : undefined,
                            color: isActive ? '#ffffff' : theme.color,
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

                {/* 右スクロールボタン */}
                {isScrollNeeded && (
                  <button
                    onClick={scrollThemeRight}
                    disabled={!canScrollRight}
                    className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-lg transition-all ${
                      canScrollRight
                        ? 'bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300'
                        : 'bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                    }`}
                    aria-label={t('scrollRight')}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}

                {/* アコーディオントグル */}
                <button
                  onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-all shrink-0 ${
                    isFilterExpanded
                      ? 'bg-amber-500 text-white shadow-md'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600'
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
                  <span className="hidden sm:inline">FILTER</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${isFilterExpanded ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>

              {/* フィルター・ソート（アコーディオンコンテンツ） */}
              <div
                className={`overflow-hidden transition-all duration-300 ease-out ${
                  isFilterExpanded
                    ? 'max-h-96 opacity-100'
                    : 'max-h-0 opacity-0'
                }`}
              >
                <div className="flex flex-wrap items-center gap-4 px-3 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30">
                  {/* ステータス */}
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      STATUS:
                    </span>
                    <div className="flex items-center">
                      {[
                        { value: 'all', label: t('all'), color: 'amber' },
                        {
                          value: 'todo',
                          label: statusConfig.todo.label,
                          color: 'slate',
                        },
                        {
                          value: 'in-progress',
                          label: statusConfig['in-progress'].label,
                          color: 'blue',
                        },
                        {
                          value: 'done',
                          label: statusConfig.done.label,
                          color: 'green',
                        },
                      ].map((statusItem, idx) => {
                        const status = statusItem.value;
                        const config = statusItem;
                        const count = statusCounts[status] || 0;
                        const isActive = filter === status;

                        return (
                          <div key={status} className="flex items-center">
                            <button
                              onClick={() => setFilter(status)}
                              className={`relative h-6 px-3 font-mono text-[10px] uppercase tracking-wider whitespace-nowrap transition-all duration-200 ${
                                isActive
                                  ? config.color === 'amber'
                                    ? 'bg-linear-to-r from-amber-500 to-amber-400 text-white shadow-md font-bold'
                                    : config.color === 'blue'
                                      ? 'bg-blue-500 text-white shadow-md font-bold'
                                      : config.color === 'green'
                                        ? 'bg-green-500 text-white shadow-md font-bold'
                                        : 'bg-slate-600 text-white shadow-md font-bold'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                              }`}
                            >
                              <div className="flex items-center gap-1">
                                {config.label}
                                <span className="text-[9px] opacity-75">
                                  {count}
                                </span>
                              </div>
                              {/* Progress indicator at bottom */}
                              {count > 0 && (
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-300 dark:bg-slate-600">
                                  <div
                                    className={`h-full transition-all duration-500 ${
                                      isActive
                                        ? 'bg-white/50'
                                        : 'bg-slate-400 dark:bg-slate-500'
                                    }`}
                                    style={{
                                      width: `${status === 'all' ? 100 : (statusCounts[status] / statusCounts.all) * 100}%`,
                                    }}
                                  />
                                </div>
                              )}
                            </button>
                            {idx < 3 && (
                              <div className="w-px h-4 bg-slate-300 dark:bg-slate-600" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 区切り線 */}
                  <div className="w-px h-6 bg-slate-300 dark:bg-slate-600"></div>

                  {/* 優先度 */}
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      PRIORITY:
                    </span>
                    <div className="flex items-center">
                      {[
                        {
                          value: '',
                          label: t('all'),
                          icon: null,
                          iconColor: '',
                          bgColor: 'amber',
                        },
                        ...(
                          Object.entries(priorityConfig) as Array<
                            [
                              keyof typeof priorityConfig,
                              (typeof priorityConfig)[keyof typeof priorityConfig],
                            ]
                          >
                        ).map(([key, config]) => ({
                          value: key,
                          label: config.title,
                          icon: <config.Icon className="w-3 h-3" />,
                          iconColor: config.color,
                          bgColor:
                            key === 'urgent'
                              ? 'red'
                              : key === 'high'
                                ? 'orange'
                                : key === 'medium'
                                  ? 'blue'
                                  : 'slate',
                        })),
                      ].map((priority, idx) => (
                        <div key={priority.value} className="flex items-center">
                          <button
                            onClick={() =>
                              setPriorityFilter(
                                priority.value
                                  ? (priority.value as Priority)
                                  : null,
                              )
                            }
                            className={`h-6 px-2.5 font-mono text-[10px] uppercase tracking-wider transition-all duration-200 whitespace-nowrap focus:outline-none focus-visible:outline-none focus-visible:ring-0 ${
                              (priorityFilter || '') === priority.value
                                ? priority.bgColor === 'amber'
                                  ? 'bg-linear-to-r from-amber-500 to-amber-400 text-white shadow-md font-bold'
                                  : priority.bgColor === 'red'
                                    ? 'bg-red-500 text-white shadow-md font-bold'
                                    : priority.bgColor === 'orange'
                                      ? 'bg-orange-500 text-white shadow-md font-bold'
                                      : priority.bgColor === 'blue'
                                        ? 'bg-blue-500 text-white shadow-md font-bold'
                                        : 'bg-slate-600 text-white shadow-md font-bold'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-1">
                              {priority.icon && (
                                <span
                                  className={
                                    (priorityFilter || '') === priority.value
                                      ? 'text-white'
                                      : priority.iconColor
                                  }
                                >
                                  {priority.icon}
                                </span>
                              )}
                              {priority.label}
                            </div>
                          </button>
                          {idx < 4 && (
                            <div className="w-px h-4 bg-slate-300 dark:bg-slate-600" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 区切り線 */}
                  <div className="w-px h-6 bg-slate-300 dark:bg-slate-600"></div>

                  {/* ソート */}
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      SORT:
                    </span>
                    <div className="flex items-center">
                      <select
                        value={sortBy}
                        onChange={(e) =>
                          setSortBy(e.target.value as typeof sortBy)
                        }
                        className="h-6 px-2 font-mono text-[10px] uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-r border-slate-300 dark:border-slate-600 focus:outline-none focus:ring-0 focus:bg-slate-200 dark:focus:bg-slate-700 transition-colors cursor-pointer"
                      >
                        <option value="createdAt">CREATED</option>
                        <option value="title">TITLE</option>
                        <option value="priority">PRIORITY</option>
                      </select>
                      <button
                        onClick={() =>
                          setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
                        }
                        className="h-6 px-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                        title={sortOrder === 'asc' ? 'ASC' : 'DESC'}
                      >
                        <svg
                          className={`w-3.5 h-3.5 text-slate-700 dark:text-slate-300 transition-transform ${
                            sortOrder === 'desc' ? 'rotate-180' : ''
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
            </div>
          ) : null)}

        {/* タスクリストの表示 */}
        {taskCacheLoading && sortedTasks.length === 0 ? (
          <TaskCardsSkeleton count={10} />
        ) : sortedTasks.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 dark:text-zinc-400">
            {/* カテゴリにテーマがない場合 */}
            {categoryFilter !== null &&
            themes.filter((t) => t.categoryId === categoryFilter).length ===
              0 ? (
              <>
                <SwatchBook className="w-16 h-16 mx-auto mb-4 text-zinc-300 dark:text-zinc-700" />
                <p className="text-lg font-medium mb-2">{t('noThemes')}</p>
                <p className="text-sm mb-4">{t('noThemesDescription')}</p>
                <button
                  onClick={() => router.push('/themes')}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium transition-colors inline-flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  {t('addTheme')}
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
                <p className="text-lg font-medium mb-2">{t('noTasks')}</p>
                <p className="text-sm mb-4">{t('noTasksDescription')}</p>
                <button
                  onClick={() => {
                    const themeParam = themeFilter || defaultTheme?.id;
                    router.push(
                      `/tasks/new${themeParam ? `?themeId=${themeParam}` : ''}`,
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
                  {t('createTask')}
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-3">
              {paginatedTasks.map((task, index) => (
                <div
                  key={task.id}
                  className="slide-in-bottom"
                  style={{
                    animationDelay: `${index * 0.02}s`,
                    animationFillMode: 'both',
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
    </div>
  );
}

// 認証が必要なコンポーネントとしてエクスポート
export default requireAuth(HomeClientPage);
