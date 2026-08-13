import { renderHook, act } from '@testing-library/react';
import { useTaskAutoSync } from '../task/useTaskAutoSync';
import { useTaskCacheStore } from '@/stores/task-cache-store';
import { useExecutionStateStore } from '@/stores/execution-state-store';
import { setAppHidden } from '../common/app-visibility-store';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe('useTaskAutoSync', () => {
  const fetchUpdates = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchUpdates.mockClear();
    useTaskCacheStore.setState({ fetchUpdates, initialized: true });
    useExecutionStateStore.setState({ executingTasks: new Map() });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    setAppHidden(false);
  });

  it('does nothing when disabled', () => {
    renderHook(() => useTaskAutoSync({ enabled: false }));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchUpdates).not.toHaveBeenCalled();
  });

  it('does nothing when the cache is not yet initialized', () => {
    useTaskCacheStore.setState({ initialized: false });
    renderHook(() => useTaskAutoSync({ enabled: true, interval: 1000 }));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(fetchUpdates).not.toHaveBeenCalled();
  });

  it('calls fetchUpdates on the configured interval', () => {
    renderHook(() => useTaskAutoSync({ enabled: true, interval: 1000, silent: true }));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(fetchUpdates).toHaveBeenCalledTimes(3);
    expect(fetchUpdates).toHaveBeenCalledWith(true);
  });

  it('skips a tick while the document is hidden', () => {
    renderHook(() => useTaskAutoSync({ enabled: true, interval: 1000 }));
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(fetchUpdates).not.toHaveBeenCalled();
  });

  it('skips a tick when skipDuringExecution is set and a task is executing', () => {
    useExecutionStateStore.setState({
      executingTasks: new Map([[1, { taskId: 1, status: 'running' }]]),
    });
    renderHook(() => useTaskAutoSync({ enabled: true, interval: 1000, skipDuringExecution: true }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(fetchUpdates).not.toHaveBeenCalled();
  });

  it('syncs on window focus', () => {
    renderHook(() => useTaskAutoSync({ enabled: true, interval: 100_000, silent: false }));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(fetchUpdates).toHaveBeenCalledWith(false);
  });

  it('does not sync on focus when skipDuringExecution and a task is executing', () => {
    useExecutionStateStore.setState({
      executingTasks: new Map([[1, { taskId: 1, status: 'running' }]]),
    });
    renderHook(() =>
      useTaskAutoSync({ enabled: true, interval: 100_000, skipDuringExecution: true }),
    );
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(fetchUpdates).not.toHaveBeenCalled();
  });

  it('syncs when visibilitychange fires while visible', () => {
    renderHook(() => useTaskAutoSync({ enabled: true, interval: 100_000 }));
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchUpdates).toHaveBeenCalled();
  });

  it('syncs immediately when the app is restored from minimize', () => {
    renderHook(() => useTaskAutoSync({ enabled: true, interval: 100_000 }));
    act(() => {
      setAppHidden(true);
    });
    fetchUpdates.mockClear();

    act(() => {
      setAppHidden(false);
    });

    expect(fetchUpdates).toHaveBeenCalled();
  });

  it('does not sync on restore when skipDuringExecution and a task is executing', () => {
    useExecutionStateStore.setState({
      executingTasks: new Map([[1, { taskId: 1, status: 'running' }]]),
    });
    renderHook(() =>
      useTaskAutoSync({ enabled: true, interval: 100_000, skipDuringExecution: true }),
    );
    act(() => {
      setAppHidden(true);
    });
    fetchUpdates.mockClear();

    act(() => {
      setAppHidden(false);
    });

    expect(fetchUpdates).not.toHaveBeenCalled();
  });

  it('clears the interval on unmount', () => {
    const clearSpy = vi.spyOn(global, 'clearInterval');
    const { unmount } = renderHook(() => useTaskAutoSync({ enabled: true, interval: 1000 }));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
