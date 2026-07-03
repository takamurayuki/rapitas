import { renderHook, act } from '@testing-library/react';
import { useSSE } from '../common/useSse';

vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    errorThrottled: vi.fn(),
  }),
}));

/** Minimal EventSource stub that records listeners and lets tests emit events. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  listeners = new Map<string, Set<(e: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  emit(type: string, data: unknown) {
    // The hook's 'error' handler gates on `event instanceof MessageEvent`, so
    // emitted events must be real MessageEvent instances, not plain objects.
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    this.listeners.get(type)?.forEach((fn) => fn(event));
  }
  close() {
    this.closed = true;
  }
}

describe('useSSE', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts disconnected and not loading', () => {
    const { result } = renderHook(() => useSSE());
    expect(result.current.isConnected).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('connect() opens an EventSource and sets isLoading true', () => {
    const { result } = renderHook(() => useSSE());
    act(() => {
      result.current.connect('/events/1');
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('/events/1');
    expect(result.current.isLoading).toBe(true);
  });

  it('sets isConnected true when the connection opens', () => {
    const { result } = renderHook(() => useSSE());
    act(() => {
      result.current.connect('/events/1');
    });
    act(() => {
      FakeEventSource.instances[0].onopen?.();
    });
    expect(result.current.isConnected).toBe(true);
  });

  it('calls onStart and fires on the start event', () => {
    const onStart = vi.fn();
    const { result } = renderHook(() => useSSE({ onStart }));
    act(() => {
      result.current.connect('/events/1');
    });
    act(() => {
      FakeEventSource.instances[0].emit('start', {});
    });
    expect(onStart).toHaveBeenCalled();
  });

  it('updates progress and progressMessage on the progress event', () => {
    const onProgress = vi.fn();
    const { result } = renderHook(() => useSSE({ onProgress }));
    act(() => {
      result.current.connect('/events/1');
    });
    act(() => {
      FakeEventSource.instances[0].emit('progress', {
        type: 'progress',
        data: { progress: 42, message: 'working' },
        timestamp: 'now',
      });
    });
    expect(result.current.progress).toBe(42);
    expect(result.current.progressMessage).toBe('working');
    expect(onProgress).toHaveBeenCalledWith({ progress: 42, message: 'working' });
  });

  it('stores data and calls onData on the data event', () => {
    const onData = vi.fn();
    const { result } = renderHook(() => useSSE<{ value: number }>({ onData }));
    act(() => {
      result.current.connect('/events/1');
    });
    act(() => {
      FakeEventSource.instances[0].emit('data', {
        type: 'data',
        data: { value: 7 },
        timestamp: 'now',
      });
    });
    expect(result.current.data).toEqual({ value: 7 });
    expect(onData).toHaveBeenCalledWith({ value: 7 });
  });

  it('sets error state and calls onError on the error event payload', () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSSE({ onError }));
    act(() => {
      result.current.connect('/events/1');
    });
    act(() => {
      FakeEventSource.instances[0].emit('error', {
        type: 'error',
        data: { error: 'boom' },
        timestamp: 'now',
      });
    });
    expect(result.current.error).toEqual({ error: 'boom' });
    expect(onError).toHaveBeenCalledWith({ error: 'boom' });
  });

  it('handles retry events', () => {
    const onRetry = vi.fn();
    const { result } = renderHook(() => useSSE({ onRetry }));
    act(() => {
      result.current.connect('/events/1');
    });
    const retryData = { retryCount: 1, maxRetries: 3, reason: 'timeout', nextRetryIn: 1000 };
    act(() => {
      FakeEventSource.instances[0].emit('retry', {
        type: 'retry',
        data: retryData,
        timestamp: 'now',
      });
    });
    expect(result.current.retryInfo).toEqual(retryData);
    expect(onRetry).toHaveBeenCalledWith(retryData);
  });

  it('handles rollback events', () => {
    const { result } = renderHook(() => useSSE());
    act(() => {
      result.current.connect('/events/1');
    });
    const rollbackData = {
      originalState: { a: 1 },
      rollbackReason: 'failure',
      timestamp: 'now',
      errorDetails: 'details',
    };
    act(() => {
      FakeEventSource.instances[0].emit('rollback', {
        type: 'rollback',
        data: rollbackData,
        timestamp: 'now',
      });
    });
    expect(result.current.rollbackInfo).toEqual(rollbackData);
  });

  it('completes and disconnects on the complete event', () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useSSE({ onComplete }));
    act(() => {
      result.current.connect('/events/1');
    });
    act(() => {
      FakeEventSource.instances[0].emit('complete', {
        type: 'complete',
        data: { ok: true },
        timestamp: 'now',
      });
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.progress).toBe(100);
    expect(onComplete).toHaveBeenCalledWith({ ok: true });
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(result.current.isConnected).toBe(false);
  });

  it('closes the connection and clears state on the connection-error handler', () => {
    const onConnectionError = vi.fn();
    const { result } = renderHook(() => useSSE({ onConnectionError }));
    act(() => {
      result.current.connect('/events/1');
    });
    act(() => {
      FakeEventSource.instances[0].onopen?.();
    });
    act(() => {
      FakeEventSource.instances[0].onerror?.(new Event('error'));
    });
    expect(result.current.isConnected).toBe(false);
    expect(result.current.error).not.toBeNull();
    expect(onConnectionError).toHaveBeenCalled();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it('disconnect() closes the EventSource and resets connection state', () => {
    const { result } = renderHook(() => useSSE());
    act(() => {
      result.current.connect('/events/1');
    });
    act(() => {
      FakeEventSource.instances[0].onopen?.();
    });
    act(() => {
      result.current.disconnect();
    });
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('reset() clears all accumulated state', () => {
    const { result } = renderHook(() => useSSE<{ v: number }>());
    act(() => {
      result.current.connect('/events/1');
    });
    act(() => {
      FakeEventSource.instances[0].emit('data', { type: 'data', data: { v: 1 }, timestamp: 'now' });
    });
    expect(result.current.data).toEqual({ v: 1 });

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('connecting again closes the previous EventSource', () => {
    const { result } = renderHook(() => useSSE());
    act(() => {
      result.current.connect('/events/1');
    });
    const first = FakeEventSource.instances[0];
    act(() => {
      result.current.connect('/events/2');
    });
    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('silently ignores malformed JSON payloads without throwing', () => {
    const { result } = renderHook(() => useSSE());
    act(() => {
      result.current.connect('/events/1');
    });
    expect(() => {
      act(() => {
        FakeEventSource.instances[0].emit('progress', 'not-an-object');
        FakeEventSource.instances[0].listeners
          .get('progress')!
          .forEach((fn) => fn({ data: 'not-json{{{' } as MessageEvent));
      });
    }).not.toThrow();
  });

  it('disconnects the EventSource on unmount', () => {
    const { result, unmount } = renderHook(() => useSSE());
    act(() => {
      result.current.connect('/events/1');
    });
    unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
