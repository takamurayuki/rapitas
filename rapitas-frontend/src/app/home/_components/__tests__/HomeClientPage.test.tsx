/**
 * HomeClientPage chrome visibility
 *
 * A brand-new account has categories (開発 / 学習) and no tasks. The task list
 * used to hide the whole filter panel in that state, so there was no way to
 * pick the category or theme to work in until a first task existed.
 *
 * These tests pin which chrome survives an empty workspace: the filter panel
 * does, the toolbar does not (its counts and bulk-selection controls have
 * nothing to act on). Every dependency is stubbed, so what is under test is
 * the page's own render conditions and nothing else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  taskCache: {
    tasks: [] as { id: number }[],
    initialized: true,
    loading: false,
    lastFetchedAt: 1,
    lastError: null as string | null,
    fetchAll: vi.fn(),
    fetchUpdates: vi.fn(),
  },
  filterData: {
    categories: [{ id: 1, name: '開発', mode: 'both' }],
    themes: [] as unknown[],
    isLoading: false,
    error: null as string | null,
    isInitialized: true,
    initializeData: vi.fn(),
    refreshData: vi.fn(),
    shouldBackgroundRefresh: vi.fn(() => false),
    backgroundRefresh: vi.fn(),
  },
  isSelectionMode: false,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// requireAuth is a pass-through wrapper in the real context too.
vi.mock('@/contexts/AuthContext', () => ({
  requireAuth: <P,>(Component: (props: P) => React.ReactNode) => Component,
}));

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://localhost:3001' }));

vi.mock('@/stores/task-cache-store', () => ({
  useTaskCacheStore: (selector: (s: typeof h.taskCache) => unknown) => selector(h.taskCache),
}));

vi.mock('@/stores/filter-data-store', () => ({
  useFilterDataStore: () => h.filterData,
}));

vi.mock('@/stores/app-mode-store', () => ({
  useAppModeStore: (selector: (s: { mode: string }) => unknown) => selector({ mode: 'all' }),
}));

vi.mock('@/stores/task-detail-visibility-store', () => ({
  useTaskDetailVisibilityStore: () => ({ showTaskDetail: vi.fn(), hideTaskDetail: vi.fn() }),
}));

vi.mock('@/stores/execution-state-store', () => ({
  useExecutionStateStore: () => ({ setTaskLoading: vi.fn(), isTaskExecuting: () => false }),
}));

vi.mock('@/hooks/task/useExecutingTasksPolling', () => ({ useExecutingTasksPolling: vi.fn() }));
vi.mock('@/hooks/task/useTaskAutoSync', () => ({ useTaskAutoSync: vi.fn() }));
vi.mock('@/hooks/common/useDebounce', () => ({ useDebounce: (value: unknown) => value }));

vi.mock('@/hooks/task/useFilteredTasks', () => ({
  useFilteredTasks: () => ({
    filteredTasks: [],
    statusCounts: { all: 0 },
    todayTasksCounts: { completed: 0, total: 0 },
  }),
}));

vi.mock('@/hooks/task/useTaskSorting', () => ({ useTaskSorting: () => [] }));

vi.mock('@/feature/tasks/components/completion/TaskCompletionAnimation', () => ({
  useTaskCompletionAnimation: () => ({ triggerTaskCompletion: vi.fn() }),
}));

vi.mock('../../_hooks/useHomeState', () => ({
  useHomeState: () => ({
    filter: 'all',
    setFilter: vi.fn(),
    categoryFilter: null,
    setCategoryFilter: vi.fn(),
    themeFilter: null,
    setThemeFilter: vi.fn(),
    priorityFilter: null,
    setPriorityFilter: vi.fn(),
    labelFilter: null,
    setLabelFilter: vi.fn(),
    isFilterExpanded: false,
    setIsFilterExpanded: vi.fn(),
    sortBy: 'createdAt',
    setSortBy: vi.fn(),
    sortOrder: 'desc',
    setSortOrder: vi.fn(),
    currentPage: 1,
    setCurrentPage: vi.fn(),
    itemsPerPage: 10,
    setItemsPerPage: vi.fn(),
    selectedTaskId: null,
    setSelectedTaskId: vi.fn(),
    isPanelOpen: false,
    setIsPanelOpen: vi.fn(),
    selectedTasks: new Set<number>(),
    setSelectedTasks: vi.fn(),
    // Read at call time so a test can flip it before rendering.
    isSelectionMode: h.isSelectionMode,
    setIsSelectionMode: vi.fn(),
    progressRingRef: { current: null },
  }),
}));

vi.mock('../../_hooks/useThemeScroll', () => ({
  useThemeScroll: () => ({
    themeScrollRef: { current: null },
    canScrollLeft: false,
    canScrollRight: false,
    isScrollNeeded: false,
    scrollThemeLeft: vi.fn(),
    scrollThemeRight: vi.fn(),
  }),
}));

vi.mock('../../_hooks/useHomeActions', () => ({
  useHomeActions: () => ({
    updateStatus: vi.fn(),
    toggleTaskSelection: vi.fn(),
    bulkUpdateStatus: vi.fn(),
    bulkDelete: vi.fn(),
  }),
}));

vi.mock('../../_hooks/useHomeInit', () => ({ useHomeInit: vi.fn() }));
vi.mock('../../_hooks/useHomeKeyboard', () => ({ useHomeKeyboard: vi.fn() }));
vi.mock('../../_hooks/useHomeSyncEffects', () => ({ useHomeSyncEffects: vi.fn() }));

vi.mock('../HomeToolbar', () => ({
  HomeToolbar: () => <div data-testid="home-toolbar" />,
}));
vi.mock('../HomeFilterPanel', () => ({
  HomeFilterPanel: () => <div data-testid="home-filter-panel" />,
}));
vi.mock('../HomeTaskList', () => ({
  HomeTaskList: () => <div data-testid="home-task-list" />,
}));
vi.mock('@/feature/tasks/components/detail/TaskSlidePanel', () => ({
  default: () => <div data-testid="task-slide-panel" />,
}));

import HomeClientPage from '../HomeClientPage';

beforeEach(() => {
  h.taskCache.tasks = [];
  h.isSelectionMode = false;
  // The page fetches labels on mount; nothing in these tests depends on them.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
  );
});

describe('HomeClientPage chrome in an empty workspace', () => {
  it('shows the filter panel when the workspace has no tasks', () => {
    render(<HomeClientPage />);
    expect(screen.getByTestId('home-filter-panel')).toBeTruthy();
  });

  it('hides the toolbar when the workspace has no tasks', () => {
    // The toolbar is counts plus bulk-selection; with no task anywhere it has
    // nothing to act on, and it competed with the empty-state CTA.
    render(<HomeClientPage />);
    expect(screen.queryByTestId('home-toolbar')).toBeNull();
  });

  it('shows both once a task exists', () => {
    h.taskCache.tasks = [{ id: 1 }];
    render(<HomeClientPage />);
    expect(screen.getByTestId('home-toolbar')).toBeTruthy();
    expect(screen.getByTestId('home-filter-panel')).toBeTruthy();
  });

  it('hides the filter panel while bulk-selecting, task or not', () => {
    h.isSelectionMode = true;
    h.taskCache.tasks = [{ id: 1 }];
    render(<HomeClientPage />);
    expect(screen.queryByTestId('home-filter-panel')).toBeNull();
  });
});
