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

  it("prefers sessionStartedAt over the execution row's own startedAt when activeTimeMs is absent (older backend)", async () => {
    // Regression: a new AgentExecution row (and thus a new startedAt) is
    // created for every workflow phase, resetting the card's elapsed-time
    // display each phase. Without the cumulative base field, sessionStartedAt
    // (the whole run's start) must win as the fallback anchor.
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

  it('stores activeTimeMs as the cumulative base and anchors on the running row (task #560)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              taskId: 6,
              sessionId: 11,
              executionStatus: 'running',
              startedAt: '2026-01-02T00:00:00.000Z',
              sessionStartedAt: '2026-01-01T00:00:00.000Z',
              activeTimeMs: 600_000,
            },
          ]),
      }),
    );

    renderHook(() => useExecutingTasksPolling());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    const store = useExecutionStateStore.getState();
    // 累積ベースがある場合は現在実行行の startedAt がアンカー
    // （セッションアンカーだと同一セッション内の完了分を二重計上する）
    expect(store.getExecutingTaskStartedAt(6)).toBe('2026-01-02T00:00:00.000Z');
    expect(store.getExecutingTaskActiveMs(6)).toBe(600_000);
  });

  it('受入3: フェーズ切替（新実行行）をまたいで累積ベースが単調増加し 0 に戻らない', async () => {
    // フェーズ1実行中 → フェーズ1完了+フェーズ2実行中（新しい行・新しい startedAt）
    let phase = 1;
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            phase === 1
              ? [
                  {
                    taskId: 7,
                    sessionId: 20,
                    executionStatus: 'running',
                    startedAt: '2026-01-01T00:00:00.000Z',
                    activeTimeMs: 0,
                  },
                ]
              : [
                  {
                    taskId: 7,
                    sessionId: 21,
                    executionStatus: 'running',
                    startedAt: '2026-01-01T00:10:30.000Z',
                    activeTimeMs: 600_000, // フェーズ1の完了実働10分が累積へ
                  },
                ],
          ),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useExecutingTasksPolling());
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(useExecutionStateStore.getState().getExecutingTaskActiveMs(7)).toBe(0);

    phase = 2;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    const store = useExecutionStateStore.getState();
    // 新しい実行行に切り替わってもタスクは実行中のまま
    expect(store.isTaskExecuting(7)).toBe(true);
    // 累積ベースは 0 に戻らず前フェーズの実働分だけ増加（単調増加）
    expect(store.getExecutingTaskActiveMs(7)).toBe(600_000);
    // アンカーは新フェーズの実行行 startedAt
    expect(store.getExecutingTaskStartedAt(7)).toBe('2026-01-01T00:10:30.000Z');
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
