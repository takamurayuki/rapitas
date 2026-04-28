vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
  buildApiUrl: (p: string) => 'http://test:3001' + p,
  fetchWithRetry: vi.fn(),
}));

import { useTaskCacheStore } from '../task-cache-store';
import { fetchWithRetry } from '@/utils/api';

describe('taskCacheStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTaskCacheStore.setState({
      tasks: [],
      lastFetchedAt: null,
      loading: false,
      initialized: false,
      connectionStatus: 'online',
      consecutiveFailures: 0,
      lastError: null,
    });
  });

  it('should have correct initial state', () => {
    const state = useTaskCacheStore.getState();
    expect(state.tasks).toEqual([]);
    expect(state.lastFetchedAt).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.initialized).toBe(false);
    expect(state.connectionStatus).toBe('online');
    expect(state.consecutiveFailures).toBe(0);
    expect(state.lastError).toBeNull();
  });

  describe('updateTaskLocally', () => {
    it('should update a task by id', () => {
      useTaskCacheStore.setState({
        tasks: [{ id: 1, title: 'Old Title' } as never],
      });
      useTaskCacheStore.getState().updateTaskLocally(1, { title: 'New Title' } as never);
      const task = useTaskCacheStore.getState().tasks.find((t) => t.id === 1);
      expect(task?.title).toBe('New Title');
    });

    it('should not modify other tasks', () => {
      useTaskCacheStore.setState({
        tasks: [{ id: 1, title: 'Task 1' } as never, { id: 2, title: 'Task 2' } as never],
      });
      useTaskCacheStore.getState().updateTaskLocally(1, { title: 'Updated' } as never);
      const task2 = useTaskCacheStore.getState().tasks.find((t) => t.id === 2);
      expect(task2?.title).toBe('Task 2');
    });
  });

  describe('removeTaskLocally', () => {
    it('should remove a task by id', () => {
      useTaskCacheStore.setState({
        tasks: [{ id: 1, title: 'Task 1' } as never, { id: 2, title: 'Task 2' } as never],
      });
      useTaskCacheStore.getState().removeTaskLocally(1);
      expect(useTaskCacheStore.getState().tasks).toHaveLength(1);
      expect(useTaskCacheStore.getState().tasks[0].id).toBe(2);
    });
  });

  describe('addTaskLocally', () => {
    it('should prepend a task to the list', () => {
      useTaskCacheStore.setState({
        tasks: [{ id: 1, title: 'Task 1' } as never],
      });
      useTaskCacheStore.getState().addTaskLocally({ id: 2, title: 'Task 2' } as never);
      const tasks = useTaskCacheStore.getState().tasks;
      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe(2);
    });
  });

  describe('setTasks', () => {
    it('should replace all tasks', () => {
      useTaskCacheStore.setState({
        tasks: [{ id: 1, title: 'Old' } as never],
      });
      useTaskCacheStore.getState().setTasks([{ id: 2, title: 'New' } as never]);
      expect(useTaskCacheStore.getState().tasks).toHaveLength(1);
      expect(useTaskCacheStore.getState().tasks[0].id).toBe(2);
    });
  });

  describe('fetchAll', () => {
    it('should fetch all tasks and update state', async () => {
      const mockTasks = [
        { id: 1, title: 'Task 1' },
        { id: 2, title: 'Task 2' },
      ];
      vi.mocked(fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTasks),
      } as Response);

      await useTaskCacheStore.getState().fetchAll();

      const state = useTaskCacheStore.getState();
      expect(state.tasks).toEqual(mockTasks);
      expect(state.initialized).toBe(true);
      expect(state.loading).toBe(false);
      expect(state.lastFetchedAt).not.toBeNull();
    });

    it('should handle fetch failure', async () => {
      vi.mocked(fetchWithRetry).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('error'),
      } as Response);

      await useTaskCacheStore.getState().fetchAll();

      const state = useTaskCacheStore.getState();
      expect(state.initialized).toBe(true);
      expect(state.loading).toBe(false);
      expect(state.tasks).toEqual([]);
    });

    it('should call fetchUpdates if already initialized', async () => {
      useTaskCacheStore.setState({
        initialized: true,
        lastFetchedAt: new Date().toISOString(),
        tasks: [{ id: 1, title: 'Existing' } as never],
      });

      const mockData = {
        incremental: true,
        tasks: [],
        totalCount: 1,
        activeIds: [1],
      };
      vi.mocked(fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      } as Response);

      await useTaskCacheStore.getState().fetchAll();

      // Should have called fetchWithRetry with since param (incremental)
      expect(fetchWithRetry).toHaveBeenCalled();
      const callUrl = vi.mocked(fetchWithRetry).mock.calls[0][0];
      expect(callUrl).toContain('since=');
    });
  });

  describe('fetchUpdates', () => {
    it('should fall back to fetchAll if no lastFetchedAt', async () => {
      const mockTasks = [{ id: 1, title: 'Task 1' }];
      vi.mocked(fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTasks),
      } as Response);

      await useTaskCacheStore.getState().fetchUpdates();

      // Should have done a full fetch since lastFetchedAt is null
      const state = useTaskCacheStore.getState();
      expect(state.tasks).toEqual(mockTasks);
    });

    it('should merge incremental updates', async () => {
      useTaskCacheStore.setState({
        tasks: [{ id: 1, title: 'Task 1' } as never, { id: 2, title: 'Task 2' } as never],
        lastFetchedAt: new Date().toISOString(),
        initialized: true,
      });

      vi.mocked(fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            incremental: true,
            tasks: [{ id: 1, title: 'Updated Task 1' }],
            totalCount: 2,
            activeIds: [1, 2],
          }),
      } as Response);

      await useTaskCacheStore.getState().fetchUpdates();

      const tasks = useTaskCacheStore.getState().tasks;
      const task1 = tasks.find((t) => t.id === 1);
      expect(task1?.title).toBe('Updated Task 1');
      expect(tasks).toHaveLength(2);
    });

    it('should remove deleted tasks using activeIds', async () => {
      useTaskCacheStore.setState({
        tasks: [
          { id: 1, title: 'Task 1' } as never,
          { id: 2, title: 'Task 2' } as never,
          { id: 3, title: 'Task 3' } as never,
        ],
        lastFetchedAt: new Date().toISOString(),
        initialized: true,
      });

      vi.mocked(fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            incremental: true,
            tasks: [],
            totalCount: 2,
            activeIds: [1, 3], // task 2 was deleted
          }),
      } as Response);

      await useTaskCacheStore.getState().fetchUpdates();

      const tasks = useTaskCacheStore.getState().tasks;
      expect(tasks).toHaveLength(2);
      expect(tasks.find((t) => t.id === 2)).toBeUndefined();
    });

    it('should not crash when backend is down (network error)', async () => {
      useTaskCacheStore.setState({
        tasks: [{ id: 1, title: 'Existing Task' } as never],
        lastFetchedAt: new Date().toISOString(),
        initialized: true,
      });

      // fetchWithRetry throws after all retries exhausted
      vi.mocked(fetchWithRetry).mockRejectedValue(
        new Error('Failed to fetch from http://test:3001/tasks after 3 attempts. Failed to fetch'),
      );

      // Should not throw
      await useTaskCacheStore.getState().fetchUpdates();

      // Existing tasks should be preserved
      const state = useTaskCacheStore.getState();
      expect(state.tasks).toHaveLength(1);
      expect(state.tasks[0].title).toBe('Existing Task');
      expect(state.loading).toBe(false);
      expect(state.connectionStatus).toBe('offline');
      expect(state.consecutiveFailures).toBe(1);
      expect(state.lastError).toContain('Failed to fetch');
    });

    it('should not set loading when silent mode and backend is down', async () => {
      useTaskCacheStore.setState({
        tasks: [{ id: 1, title: 'Task' } as never],
        lastFetchedAt: new Date().toISOString(),
        initialized: true,
        loading: false,
      });

      vi.mocked(fetchWithRetry).mockRejectedValue(new Error('Failed to fetch after 3 attempts'));

      await useTaskCacheStore.getState().fetchUpdates(true); // silent = true

      // loading should never have been set to true
      expect(useTaskCacheStore.getState().loading).toBe(false);
    });

    it('should set loading to false after non-silent error', async () => {
      useTaskCacheStore.setState({
        tasks: [],
        lastFetchedAt: new Date().toISOString(),
        initialized: true,
      });

      vi.mocked(fetchWithRetry).mockRejectedValue(new Error('Failed to fetch after 3 attempts'));

      await useTaskCacheStore.getState().fetchUpdates(false); // silent = false

      expect(useTaskCacheStore.getState().loading).toBe(false);
    });

    it('should recover after backend comes back online', async () => {
      useTaskCacheStore.setState({
        tasks: [{ id: 1, title: 'Old Task' } as never],
        lastFetchedAt: new Date().toISOString(),
        initialized: true,
      });

      // First call: backend is down
      vi.mocked(fetchWithRetry).mockRejectedValueOnce(
        new Error('Failed to fetch after 3 attempts'),
      );

      await useTaskCacheStore.getState().fetchUpdates(true);
      expect(useTaskCacheStore.getState().tasks).toHaveLength(1);
      expect(useTaskCacheStore.getState().connectionStatus).toBe('offline');
      expect(useTaskCacheStore.getState().consecutiveFailures).toBe(1);

      // Second call: backend is back
      vi.mocked(fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            incremental: true,
            tasks: [
              { id: 1, title: 'Updated Task' },
              { id: 2, title: 'New Task' },
            ],
            totalCount: 2,
            activeIds: [1, 2],
          }),
      } as Response);

      await useTaskCacheStore.getState().fetchUpdates(true);

      const state = useTaskCacheStore.getState();
      expect(state.tasks).toHaveLength(2);
      expect(state.tasks.find((t) => t.id === 1)?.title).toBe('Updated Task');
      expect(state.tasks.find((t) => t.id === 2)?.title).toBe('New Task');
      expect(state.connectionStatus).toBe('online');
      expect(state.consecutiveFailures).toBe(0);
      expect(state.lastError).toBeNull();
    });

    it('should handle non-incremental response gracefully', async () => {
      useTaskCacheStore.setState({
        tasks: [{ id: 1, title: 'Old' } as never],
        lastFetchedAt: new Date().toISOString(),
        initialized: true,
      });

      // Server returns plain array (no incremental flag)
      const plainTasks = [
        { id: 1, title: 'Task 1' },
        { id: 2, title: 'Task 2' },
      ];
      vi.mocked(fetchWithRetry).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(plainTasks),
      } as Response);

      await useTaskCacheStore.getState().fetchUpdates();

      const state = useTaskCacheStore.getState();
      expect(state.tasks).toEqual(plainTasks);
      expect(state.lastFetchedAt).not.toBeNull();
    });

    it('should handle HTTP error response without crashing', async () => {
      useTaskCacheStore.setState({
        tasks: [{ id: 1, title: 'Kept' } as never],
        lastFetchedAt: new Date().toISOString(),
        initialized: true,
      });

      vi.mocked(fetchWithRetry).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      await useTaskCacheStore.getState().fetchUpdates();

      // Tasks should be preserved on error
      expect(useTaskCacheStore.getState().tasks).toHaveLength(1);
      expect(useTaskCacheStore.getState().tasks[0].title).toBe('Kept');
    });

    it('should refetch all when local count exceeds server count without activeIds', async () => {
      useTaskCacheStore.setState({
        tasks: [
          { id: 1, title: 'Task 1' } as never,
          { id: 2, title: 'Task 2' } as never,
          { id: 3, title: 'Task 3' } as never,
        ],
        lastFetchedAt: new Date().toISOString(),
        initialized: true,
      });

      // First call returns incremental with no activeIds and lower totalCount
      vi.mocked(fetchWithRetry)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              incremental: true,
              tasks: [],
              totalCount: 2,
              activeIds: [], // empty activeIds triggers count-based fallback
            }),
        } as Response)
        // Second call is the full refetch triggered by count mismatch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve([
              { id: 1, title: 'Task 1' },
              { id: 2, title: 'Task 2' },
            ]),
        } as Response);

      await useTaskCacheStore.getState().fetchUpdates();

      // Should have triggered a full refetch
      expect(fetchWithRetry).toHaveBeenCalledTimes(2);
    });

    it('should track consecutive failures across multiple fetch attempts', async () => {
      useTaskCacheStore.setState({
        tasks: [{ id: 1, title: 'Task' } as never],
        lastFetchedAt: new Date().toISOString(),
        initialized: true,
      });

      vi.mocked(fetchWithRetry).mockRejectedValue(new Error('Failed to fetch'));

      await useTaskCacheStore.getState().fetchUpdates(true);
      expect(useTaskCacheStore.getState().consecutiveFailures).toBe(1);

      await useTaskCacheStore.getState().fetchUpdates(true);
      expect(useTaskCacheStore.getState().consecutiveFailures).toBe(2);

      await useTaskCacheStore.getState().fetchUpdates(true);
      expect(useTaskCacheStore.getState().consecutiveFailures).toBe(3);
    });

    it('should set connectionStatus to reconnecting when retrying from offline', async () => {
      useTaskCacheStore.setState({
        tasks: [{ id: 1, title: 'Task' } as never],
        lastFetchedAt: new Date().toISOString(),
        initialized: true,
        connectionStatus: 'offline',
        consecutiveFailures: 2,
        lastError: 'Previous error',
      });

      // Track intermediate state during fetch
      let statusDuringFetch: string | undefined;
      vi.mocked(fetchWithRetry).mockImplementation(async () => {
        statusDuringFetch = useTaskCacheStore.getState().connectionStatus;
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              incremental: true,
              tasks: [],
              totalCount: 1,
              activeIds: [1],
            }),
        } as Response;
      });

      await useTaskCacheStore.getState().fetchUpdates(true);

      expect(statusDuringFetch).toBe('reconnecting');
      expect(useTaskCacheStore.getState().connectionStatus).toBe('online');
    });

    it('should set offline on HTTP error response', async () => {
      useTaskCacheStore.setState({
        tasks: [{ id: 1, title: 'Task' } as never],
        lastFetchedAt: new Date().toISOString(),
        initialized: true,
      });

      vi.mocked(fetchWithRetry).mockResolvedValue({
        ok: false,
        status: 503,
      } as Response);

      await useTaskCacheStore.getState().fetchUpdates(true);

      const state = useTaskCacheStore.getState();
      expect(state.connectionStatus).toBe('offline');
      expect(state.lastError).toBe('HTTP 503');
      expect(state.tasks).toHaveLength(1); // tasks preserved
    });
  });

  describe('fetchAll - error resilience', () => {
    it('should not crash when backend is completely down', async () => {
      vi.mocked(fetchWithRetry).mockRejectedValue(
        new Error('Failed to fetch after 3 attempts. Failed to fetch'),
      );

      await useTaskCacheStore.getState().fetchAll();

      const state = useTaskCacheStore.getState();
      // Should still mark as initialized so UI shows empty state
      expect(state.initialized).toBe(true);
      expect(state.loading).toBe(false);
      expect(state.tasks).toEqual([]);
      expect(state.connectionStatus).toBe('offline');
      expect(state.consecutiveFailures).toBe(1);
    });

    it('should recover on subsequent fetchAll after initial failure', async () => {
      // First: backend down
      vi.mocked(fetchWithRetry).mockRejectedValueOnce(new Error('Failed to fetch'));

      await useTaskCacheStore.getState().fetchAll();
      expect(useTaskCacheStore.getState().tasks).toEqual([]);

      // Reset initialized to allow full fetch again
      useTaskCacheStore.setState({ initialized: false });

      // Second: backend recovered
      const mockTasks = [{ id: 1, title: 'Task 1' }];
      vi.mocked(fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTasks),
      } as Response);

      await useTaskCacheStore.getState().fetchAll();
      expect(useTaskCacheStore.getState().tasks).toEqual(mockTasks);
    });
  });
});
