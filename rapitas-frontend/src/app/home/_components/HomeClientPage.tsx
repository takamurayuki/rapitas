'use client';
// HomeClientPage
import { useCallback, useEffect, useMemo, useState } from 'react';
import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Status, Theme, UserSettings } from '@/types';
import TaskSlidePanel from '@/feature/tasks/components/detail/TaskSlidePanel';
import { useTaskDetailVisibilityStore } from '@/stores/task-detail-visibility-store';
import { useExecutingTasksPolling } from '@/hooks/task/useExecutingTasksPolling';
import { useAppModeStore } from '@/stores/app-mode-store';
import { useTaskCacheStore } from '@/stores/task-cache-store';
import { useExecutionStateStore } from '@/stores/execution-state-store';
import { useTaskCompletionAnimation } from '@/feature/tasks/components/completion/TaskCompletionAnimation';
import { useFilteredTasks } from '@/hooks/task/useFilteredTasks';
import { useTaskSorting } from '@/hooks/task/useTaskSorting';
import { useDebounce } from '@/hooks/common/useDebounce';
import { useTaskAutoSync } from '@/hooks/task/useTaskAutoSync';
import { requireAuth } from '@/contexts/AuthContext';
import { useFilterDataStore } from '@/stores/filter-data-store';

import { useHomeState } from '../_hooks/useHomeState';
import { useThemeScroll } from '../_hooks/useThemeScroll';
import { useHomeActions } from '../_hooks/useHomeActions';
import { useHomeInit } from '../_hooks/useHomeInit';
import { useHomeKeyboard } from '../_hooks/useHomeKeyboard';
import { useHomeSyncEffects } from '../_hooks/useHomeSyncEffects';
import { HomeToolbar } from './HomeToolbar';
import { HomeQuickAdd } from './HomeQuickAdd';
import { HomeFilterPanel } from './HomeFilterPanel';
import { HomeTaskList } from './HomeTaskList';

function HomeClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get('search') || '';
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const { showTaskDetail, hideTaskDetail } = useTaskDetailVisibilityStore();
  const appMode = useAppModeStore((state) => state.mode);

  const tasks = useTaskCacheStore((s) => s.tasks);
  const taskCacheInitialized = useTaskCacheStore((s) => s.initialized);
  const taskCacheLoading = useTaskCacheStore((s) => s.loading);
  const fetchAllTasks = useTaskCacheStore((s) => s.fetchAll);
  const fetchTaskUpdates = useTaskCacheStore((s) => s.fetchUpdates);

  const {
    categories,
    themes,
    isLoading: filtersLoading,
    error: filtersError,
    initializeData: initializeFilterData,
    refreshData: refreshFilterData,
    shouldBackgroundRefresh,
    backgroundRefresh,
  } = useFilterDataStore();

  // --- Local UI state ---
  const {
    filter,
    setFilter,
    categoryFilter,
    setCategoryFilter,
    themeFilter,
    setThemeFilter,
    priorityFilter,
    setPriorityFilter,
    isFilterExpanded,
    setIsFilterExpanded,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    setItemsPerPage,
    selectedTaskId,
    setSelectedTaskId,
    isPanelOpen,
    setIsPanelOpen,
    isQuickAdding,
    setIsQuickAdding,
    quickTaskTitle,
    setQuickTaskTitle,
    selectedTasks,
    setSelectedTasks,
    isSelectionMode,
    setIsSelectionMode,
    progressRingRef,
  } = useHomeState();

  const [defaultTheme, setDefaultTheme] = useState<Theme | null>(null);
  const [globalSettings, setGlobalSettings] = useState<UserSettings | null>(null);

  // fetchTasks: incremental after first load, full fetch otherwise
  const fetchTasks = useCallback(async () => {
    if (taskCacheInitialized) {
      await fetchTaskUpdates();
    } else {
      await fetchAllTasks();
    }
  }, [taskCacheInitialized, fetchTaskUpdates, fetchAllTasks]);

  useTaskAutoSync({
    enabled: true,
    interval: 30000,
    silent: true,
    skipDuringExecution: true,
  });

  useHomeInit({
    taskCacheInitialized,
    fetchAllTasks,
    fetchTaskUpdates,
    initializeFilterData,
    categoryFilter,
    categories,
    setCategoryFilter,
    setGlobalSettings,
  });

  const { filteredTasks, statusCounts, todayTasksCounts } = useFilteredTasks({
    tasks,
    filter,
    categoryFilter,
    themeFilter,
    priorityFilter,
    searchQuery: debouncedSearchQuery,
    themes,
  });
  const sortedTasks = useTaskSorting({
    tasks: filteredTasks,
    sortBy,
    sortOrder,
  });
  const completedTasksCount = todayTasksCounts.completed;
  const totalTasksCount = todayTasksCounts.total;

  const {
    themeScrollRef,
    canScrollLeft,
    canScrollRight,
    isScrollNeeded,
    scrollThemeLeft,
    scrollThemeRight,
  } = useThemeScroll([themes, categoryFilter]);

  const isTodayTask = useCallback((task?: (typeof tasks)[number] | null) => {
    if (!task || task.parentId) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const taskDate = new Date(task.createdAt);
    taskDate.setHours(0, 0, 0, 0);
    return taskDate.getTime() === today.getTime();
  }, []);

  const { sweepingTaskId, triggerTaskCompletion } = useTaskCompletionAnimation(
    totalTasksCount,
    completedTasksCount,
    progressRingRef as React.RefObject<HTMLDivElement>,
  );

  const { updateStatus, handleQuickAdd, toggleTaskSelection, bulkUpdateStatus, bulkDelete } =
    useHomeActions({
      tasks,
      themes,
      categoryFilter,
      themeFilter,
      defaultTheme,
      isSelectionMode,
      selectedTasks,
      setSelectedTasks,
      setIsSelectionMode,
      setIsQuickAdding,
      setQuickTaskTitle,
      triggerTaskCompletion,
      isTodayTask,
      fetchTasks,
    });

  const totalPages = Math.ceil(sortedTasks.length / itemsPerPage);
  const paginatedTasks = sortedTasks.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  const visibleCategories = useMemo(() => {
    return categories.filter((cat) => {
      if (appMode === 'all') return true;
      if (cat.mode === 'both') return true;
      return cat.mode === appMode;
    });
  }, [categories, appMode]);

  const themesInCategoryCount = useMemo(
    () => themes.filter((t) => t.categoryId === categoryFilter).length,
    [themes, categoryFilter],
  );

  useHomeSyncEffects({
    filter,
    categoryFilter,
    themeFilter,
    priorityFilter,
    searchQuery,
    themes,
    visibleCategories,
    setCategoryFilter,
    setThemeFilter,
    setDefaultTheme,
    currentPage,
    totalPages,
    setCurrentPage,
    shouldBackgroundRefresh,
    backgroundRefresh,
  });

  useHomeKeyboard({
    isQuickAdding,
    isSelectionMode,
    themeFilter,
    defaultThemeId: defaultTheme?.id,
    setIsQuickAdding,
    setIsSelectionMode,
    setSelectedTasks,
    setQuickTaskTitle,
  });

  const { setTaskLoading } = useExecutionStateStore();
  const openTaskPanel = useCallback(
    (taskId: number) => {
      setTaskLoading(taskId);
      setSelectedTaskId(taskId);
      setIsPanelOpen(true);
      showTaskDetail();
      // NOTE: Encode the open panel in the URL so router.back() from the note split view
      // returns here with ?panel=taskId, allowing the mount effect below to re-open it.
      router.replace(
        `/?panel=${taskId}${searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : ''}`,
      );
    },
    [router, searchQuery, showTaskDetail, setSelectedTaskId, setIsPanelOpen, setTaskLoading],
  );

  const closeTaskPanel = useCallback(() => {
    setIsPanelOpen(false);
    hideTaskDetail();
    setTimeout(() => setSelectedTaskId(null), 300);
    // Remove panel param from URL, preserving other params (e.g. ?search=).
    const params = new URLSearchParams(window.location.search);
    params.delete('panel');
    const qs = params.toString();
    router.replace('/' + (qs ? `?${qs}` : ''));
  }, [router, hideTaskDetail, setIsPanelOpen, setSelectedTaskId]);

  // Restore slide panel after returning from the note split view via router.back().
  useEffect(() => {
    const panelTaskId = searchParams.get('panel');
    if (panelTaskId) {
      openTaskPanel(Number(panelTaskId));
    }
    // NOTE: [] is intentional — runs once on mount only to restore URL-encoded panel state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NOTE: Poll only to reflect executing state onto task cards (spinner). Do NOT
  // auto-open the detail panel on execution — its backdrop covered the list and
  // made it look frozen / stuck-loading while an agent ran. The user opens a task
  // manually via onTaskClick when they want to watch progress.
  useExecutingTasksPolling({ interval: 5000 });

  const handleSelectAll = () => {
    const allSelected = selectedTasks.size === paginatedTasks.length && paginatedTasks.length > 0;
    if (allSelected) {
      setSelectedTasks(new Set());
      setIsSelectionMode(false);
    } else setSelectedTasks(new Set(paginatedTasks.map((t) => t.id)));
  };

  // The toolbar auto-execution toggle controls the ACTIVE development theme's
  // auto-run. Resolve the selected (or default) theme and gate on isDevelopment;
  // null hides the toggle for non-dev themes.
  const selectedThemeForAutoRun = themes.find((th) => th.id === themeFilter) ?? defaultTheme;
  const autoRunTheme = selectedThemeForAutoRun?.isDevelopment ? selectedThemeForAutoRun : null;

  // --- Render ---
  return (
    <div className="h-[calc(100vh-4.2rem)] overflow-auto bg-background">
      <div className="mx-auto max-w-6xl px-3 sm:px-4 md:px-6 py-3 sm:py-4">
        <HomeToolbar
          completedTasksCount={completedTasksCount}
          totalTasksCount={totalTasksCount}
          isSelectionMode={isSelectionMode}
          selectedTasksSize={selectedTasks.size}
          paginatedTasks={paginatedTasks}
          isQuickAdding={isQuickAdding}
          themeFilter={themeFilter}
          defaultThemeId={defaultTheme?.id}
          autoRunTheme={autoRunTheme}
          onQuickAddToggle={() => setIsQuickAdding(!isQuickAdding)}
          onBulkUpdateStatus={bulkUpdateStatus}
          onBulkDelete={bulkDelete}
          onSelectAll={handleSelectAll}
          onToggleSelectionMode={() => {
            setIsSelectionMode(!isSelectionMode);
            setSelectedTasks(new Set());
          }}
        />

        <HomeQuickAdd
          isQuickAdding={isQuickAdding}
          quickTaskTitle={quickTaskTitle}
          onTitleChange={setQuickTaskTitle}
          onSubmit={() => handleQuickAdd(quickTaskTitle)}
          onCancel={() => {
            setIsQuickAdding(false);
            setQuickTaskTitle('');
          }}
        />

        {!isSelectionMode && (
          <HomeFilterPanel
            categories={categories}
            themes={themes}
            categoryFilter={categoryFilter}
            themeFilter={themeFilter}
            filter={filter}
            priorityFilter={priorityFilter}
            sortBy={sortBy}
            sortOrder={sortOrder}
            appMode={appMode}
            globalSettings={globalSettings}
            filtersLoading={filtersLoading}
            filtersError={filtersError}
            isFilterExpanded={isFilterExpanded}
            isScrollNeeded={isScrollNeeded}
            canScrollLeft={canScrollLeft}
            canScrollRight={canScrollRight}
            statusCounts={{ ...statusCounts, all: statusCounts.all ?? 0 }}
            themeScrollRef={themeScrollRef as React.RefObject<HTMLDivElement>}
            onCategoryChange={(catId, newThemeId) => {
              setCategoryFilter(catId);
              setThemeFilter(newThemeId);
            }}
            onThemeChange={setThemeFilter}
            onFilterChange={setFilter}
            onPriorityChange={setPriorityFilter}
            onSortByChange={setSortBy}
            onSortOrderToggle={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
            onFilterExpandedToggle={() => setIsFilterExpanded(!isFilterExpanded)}
            onScrollLeft={scrollThemeLeft}
            onScrollRight={scrollThemeRight}
            onRetry={refreshFilterData}
          />
        )}

        <HomeTaskList
          paginatedTasks={paginatedTasks}
          sortedTasksCount={sortedTasks.length}
          isLoading={taskCacheLoading}
          initialized={taskCacheInitialized}
          categoryFilter={categoryFilter}
          themesInCategoryCount={themesInCategoryCount}
          themeFilter={themeFilter}
          defaultThemeId={defaultTheme?.id}
          selectedTasks={selectedTasks}
          isSelectionMode={isSelectionMode}
          sweepingTaskId={sweepingTaskId}
          currentPage={currentPage}
          totalPages={totalPages}
          itemsPerPage={itemsPerPage}
          onTaskClick={openTaskPanel}
          onStatusChange={updateStatus}
          onToggleSelect={toggleTaskSelection}
          onTaskUpdated={fetchTasks}
          onOpenInPage={(taskId) => router.push(`/tasks/${taskId}?showHeader=true`)}
          onPageChange={setCurrentPage}
          onItemsPerPageChange={setItemsPerPage}
        />
      </div>

      <TaskSlidePanel
        taskId={selectedTaskId}
        isOpen={isPanelOpen}
        onClose={closeTaskPanel}
        onTaskUpdated={fetchTasks}
      />
    </div>
  );
}

export default requireAuth(HomeClientPage);
