import {
  fetchTasksByCategories,
  updateTaskStatusBatch,
  searchTasks,
  preloadTaskDetails,
  fetchTaskStatistics,
  fetchRecentTasks,
  fetchTaskDependencies,
  smartPrefetchTasks,
} from '../task-api';

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock api-client
const mockApiFetch = vi.fn();
const mockDebouncedFetch = vi.fn();
const mockParallelFetch = vi.fn();
const mockPrefetch = vi.fn();

vi.mock('../api-client', () => ({
  apiClient: {
    prefetch: (...args: unknown[]) => mockPrefetch(...args),
  },
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  debouncedFetch: (...args: unknown[]) => mockDebouncedFetch(...args),
  parallelFetch: (...args: unknown[]) => mockParallelFetch(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchTasksByCategories', () => {
  it('returns empty object for empty categoryIds', async () => {
    const result = await fetchTasksByCategories([]);
    expect(result).toEqual({});
    expect(mockParallelFetch).not.toHaveBeenCalled();
  });

  it('fetches tasks for multiple categories in parallel', async () => {
    mockParallelFetch.mockResolvedValue({
      category_1: [{ id: 1, title: 'Task 1' }],
      category_2: [{ id: 2, title: 'Task 2' }],
    });

    const result = await fetchTasksByCategories([1, 2]);

    expect(mockParallelFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        category_1: expect.objectContaining({ path: '/tasks?categoryId=1' }),
        category_2: expect.objectContaining({ path: '/tasks?categoryId=2' }),
      }),
    );
    expect(result[1]).toEqual([{ id: 1, title: 'Task 1' }]);
    expect(result[2]).toEqual([{ id: 2, title: 'Task 2' }]);
  });

  it('returns empty array for categories with errors', async () => {
    mockParallelFetch.mockResolvedValue({
      category_1: { error: 'Network error' },
    });

    const result = await fetchTasksByCategories([1]);
    expect(result[1]).toEqual([]);
  });
});

describe('updateTaskStatusBatch', () => {
  it('sends batch update request', async () => {
    mockApiFetch.mockResolvedValue(undefined);

    const updates = [
      { id: 1, status: 'done' as const },
      { id: 2, status: 'in-progress' as const },
    ];
    await updateTaskStatusBatch(updates);

    expect(mockApiFetch).toHaveBeenCalledWith('/tasks/batch-update-status', {
      method: 'POST',
      body: JSON.stringify({ updates }),
    });
  });
});

describe('searchTasks', () => {
  it('returns empty array for empty query', async () => {
    const result = await searchTasks('');
    expect(result).toEqual([]);
    expect(mockDebouncedFetch).not.toHaveBeenCalled();
  });

  it('returns empty array for whitespace-only query', async () => {
    const result = await searchTasks('   ');
    expect(result).toEqual([]);
  });

  it('calls debouncedFetch with encoded query', async () => {
    mockDebouncedFetch.mockResolvedValue([{ id: 1, title: 'found' }]);

    const result = await searchTasks('test query');

    expect(mockDebouncedFetch).toHaveBeenCalledWith(
      '/tasks/search?q=test%20query',
      { cacheTime: 60000 },
      500,
    );
    expect(result).toEqual([{ id: 1, title: 'found' }]);
  });
});

describe('preloadTaskDetails', () => {
  it('prefetches task detail paths', async () => {
    mockPrefetch.mockResolvedValue(undefined);

    await preloadTaskDetails([10, 20]);

    expect(mockPrefetch).toHaveBeenCalledWith(['/tasks/10', '/tasks/20'], 300000);
  });
});

describe('fetchTaskStatistics', () => {
  it('fetches statistics with cache', async () => {
    const stats = { total: 5, byStatus: {}, byCategory: {} };
    mockApiFetch.mockResolvedValue(stats);

    const result = await fetchTaskStatistics();

    expect(mockApiFetch).toHaveBeenCalledWith('/tasks/statistics', {
      cacheTime: 300000,
    });
    expect(result).toEqual(stats);
  });
});

describe('fetchRecentTasks', () => {
  it('fetches recent tasks with default limit', async () => {
    mockApiFetch.mockResolvedValue([]);

    await fetchRecentTasks();

    expect(mockApiFetch).toHaveBeenCalledWith('/tasks/recent?limit=10', {
      cacheTime: 60000,
    });
  });

  it('fetches recent tasks with custom limit', async () => {
    mockApiFetch.mockResolvedValue([]);

    await fetchRecentTasks(5);

    expect(mockApiFetch).toHaveBeenCalledWith('/tasks/recent?limit=5', {
      cacheTime: 60000,
    });
  });
});

describe('fetchTaskDependencies', () => {
  it('returns empty object for empty taskIds', async () => {
    const result = await fetchTaskDependencies([]);
    expect(result).toEqual({});
  });

  it('fetches dependencies for multiple tasks', async () => {
    mockParallelFetch.mockResolvedValue({
      task_1: [2, 3],
      task_2: [4],
    });

    const result = await fetchTaskDependencies([1, 2]);

    expect(result[1]).toEqual([2, 3]);
    expect(result[2]).toEqual([4]);
  });

  it('returns empty array for tasks with errors', async () => {
    mockParallelFetch.mockResolvedValue({
      task_1: { error: 'not found' },
    });

    const result = await fetchTaskDependencies([1]);
    expect(result[1]).toEqual([]);
  });
});

describe('smartPrefetchTasks', () => {
  it('prefetches statistics by default', async () => {
    mockPrefetch.mockResolvedValue(undefined);

    await smartPrefetchTasks();

    expect(mockPrefetch).toHaveBeenCalledWith(
      expect.arrayContaining(['/tasks/statistics']),
      120000,
    );
  });

  it('prefetches task-related paths when taskId is given', async () => {
    mockPrefetch.mockResolvedValue(undefined);

    await smartPrefetchTasks(5);

    expect(mockPrefetch).toHaveBeenCalledWith(
      expect.arrayContaining(['/tasks/5/related', '/tasks/5/dependencies', '/tasks/statistics']),
      120000,
    );
  });

  it('prefetches category page when categoryId is given', async () => {
    mockPrefetch.mockResolvedValue(undefined);

    await smartPrefetchTasks(undefined, 3);

    expect(mockPrefetch).toHaveBeenCalledWith(
      expect.arrayContaining(['/tasks?categoryId=3&page=2', '/tasks/statistics']),
      120000,
    );
  });
});
