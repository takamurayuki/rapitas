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

import { useTaskCacheStore } from '../taskCacheStore';
import { fetchWithRetry } from '@/utils/api';

describe('taskCacheStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTaskCacheStore.setState({
      tasks: [],
      lastFetchedAt: null,
      loading: false,
      initialized: false,
    });
  });

  it('should have correct initial state', () => {
    const state = useTaskCacheStore.getState();
    expect(state.tasks).toEqual([]);
    expect(state.lastFetchedAt).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.initialized).toBe(false);
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
        tasks: [
          { id: 1, title: 'Task 1' } as never,
          { id: 2, title: 'Task 2' } as never,
        ],
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
      const mockTasks = [{ id: 1, title: 'Task 1' }, { id: 2, title: 'Task 2' }];
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
        tasks: [
          { id: 1, title: 'Task 1' } as never,
          { id: 2, title: 'Task 2' } as never,
        ],
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
  });
});
