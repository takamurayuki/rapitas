import { renderHook, act } from '@testing-library/react';
import { useExecutingTasksPolling } from '../task/useExecutingTasksPolling';
import { useExecutionStateStore } from '@/stores/execution-state-store';
import { useTaskCacheStore } from '@/stores/task-cache-store';
import { setAppHidden } from '../common/app-visibility-store';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

describe('useExecutingTasksPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useExecutionStateStore.setState({ executingTasks: new Map() });
    useTaskCacheStore.setState({ initialized: true });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setAppHidden(false);
  });

  it('marks running tasks as executing in the store', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { taskId: 1, sessionId: 10, executionStatus: 'running', startedAt: '2026-01-01' },
          ]),
      }),
    );

    renderHook(() => useExecutingTasksPolling());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(useExecutionStateStore.getState().isTaskExecuting(1)).toBe(true);
  });

  it("prefers sessionStartedAt over the execution row's own startedAt for the elapsed-time anchor", async () => {
    // Regression: a new AgentExecution row (and thus a new startedAt) is
    // created for every workflow phase, resetting the card's elapsed-time
    // display each phase. sessionStartedAt (the whole run's start) must win.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              taskId: 5,
              sessionId: 10,
              executionStatus: 'running',
              startedAt: '2026-01-02T00:00:00.000Z',
              sessionStartedAt: '2026-01-01T00:00:00.000Z',
            },
          ]),
      }),
    );

    renderHook(() => useExecutingTasksPolling());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(useExecutionStateStore.getState().getExecutingTaskStartedAt(5)).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('propagates a running subtask to its parent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { taskId: 2, parentId: 99, executionStatus: 'running', startedAt: null },
          ]),
      }),
    );

    renderHook(() => useExecutingTasksPolling());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(useExecutionStateStore.getState().isTaskExecuting(99)).toBe(true);
  });

  it('calls onExecutingTaskFound only for newly detected tasks', async () => {
    const found = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ taskId: 3, executionStatus: 'running', startedAt: null }]),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useExecutingTasksPolling({ onExecutingTaskFound: found }));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(found).toHaveBeenCalledTimes(1);
    expect(found).toHaveBeenCalledWith(3);

    // Second poll with the same task should not re-notify.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(found).toHaveBeenCalledTimes(1);
  });

  it('removes a task from the store once it stops appearing as executing', async () => {
    // Driven by a mutable flag rather than a fixed once-queue: the mount effect
    // may invoke the poll callback more than once synchronously (interval
    // registration + immediate call both flush under fake timers), so a
    // call-count-sensitive mock is fragile here.
    let taskRunning = true;
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            taskRunning ? [{ taskId: 4, executionStatus: 'running', startedAt: null }] : [],
          ),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useExecutingTasksPolling());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(useExecutionStateStore.getState().isTaskExecuting(4)).toBe(true);

    taskRunning = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(useExecutionStateStore.getState().isTaskExecuting(4)).toBe(false);
  });

  it('does not poll while the document is hidden', async () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useExecutingTasksPolling());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('polls immediately when restored from minimize', async () => {
    setAppHidden(true);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useExecutingTasksPolling());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      setAppHidden(false);
      await vi.runOnlyPendingTimersAsync();
    });

    expect(fetchMock).toHaveBeenCalled();
  });

  it('clears the interval on unmount', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }),
    );
    const clearSpy = vi.spyOn(global, 'clearInterval');
    const { unmount } = renderHook(() => useExecutingTasksPolling());
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
