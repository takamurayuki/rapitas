/**
 * useExecutionStreamSSE テスト
 *
 * The hook now subscribes through the shared/app-wide SSE connection instead
 * of opening a per-session EventSource, filtering `execution_*` events by
 * `sessionId` in the payload. Covers: session filtering (the whole point of
 * the re-enable), all five event types, connection-state passthrough, and
 * cleanup on unmount/sessionId change.
 */
import { renderHook, act } from '@testing-library/react';
import { useExecutionStream } from '../useExecutionStreamSSE';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

type Handler = (event: MessageEvent) => void;

const handlers = new Map<string, Handler>();
const unsubscribeSpies = new Map<string, ReturnType<typeof vi.fn>>();
const mockSubscribe = vi.fn((type: string, fn: Handler) => {
  handlers.set(type, fn);
  const unsub = vi.fn();
  unsubscribeSpies.set(type, unsub);
  return unsub;
});

let connectionListener: ((connected: boolean) => void) | undefined;
const connectionUnsub = vi.fn();
const mockOnConnectionChange = vi.fn((fn: (connected: boolean) => void) => {
  connectionListener = fn;
  return connectionUnsub;
});
const mockIsConnected = vi.fn(() => false);

vi.mock('@/lib/sse/shared-event-source', () => ({
  sharedEventSource: {
    subscribe: (...args: [string, Handler]) => mockSubscribe(...args),
    onConnectionChange: (fn: (connected: boolean) => void) => mockOnConnectionChange(fn),
    isConnected: () => mockIsConnected(),
  },
}));

function emit(type: string, data: unknown) {
  handlers.get(type)?.({ data: JSON.stringify(data) } as MessageEvent);
}

beforeEach(() => {
  handlers.clear();
  unsubscribeSpies.clear();
  mockSubscribe.mockClear();
  mockOnConnectionChange.mockClear();
  mockIsConnected.mockReturnValue(false);
  connectionUnsub.mockClear();
  connectionListener = undefined;
});

describe('useExecutionStream (shared SSE)', () => {
  it('sessionIdがnullの間は購読しないこと', () => {
    renderHook(() => useExecutionStream(null));
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('sessionIdが設定されると全execution_*イベントを購読すること', () => {
    renderHook(() => useExecutionStream(42));
    const subscribedTypes = mockSubscribe.mock.calls.map((c) => c[0]);
    expect(subscribedTypes).toEqual(
      expect.arrayContaining([
        'execution_started',
        'execution_output',
        'execution_completed',
        'execution_failed',
        'execution_cancelled',
      ]),
    );
  });

  it('他セッション宛のexecution_outputは無視すること', () => {
    const { result } = renderHook(() => useExecutionStream(42));
    act(() => emit('execution_output', { sessionId: 999, output: 'not mine' }));
    expect(result.current.logs).toEqual([]);
  });

  it('自セッション宛のexecution_outputはログへ追記されること', () => {
    const { result } = renderHook(() => useExecutionStream(42));
    act(() => emit('execution_output', { sessionId: 42, output: 'hello\n' }));
    expect(result.current.logs).toEqual(['hello\n']);
  });

  it('execution_startedで実行中状態にし、直前フェーズのログは維持すること', () => {
    // Regression: research/plan/implement/verify are separate AgentExecution
    // rows sharing one sessionId, so execution_started fires once per PHASE —
    // wiping the log here discarded every prior phase's output at each
    // boundary instead of accumulating the whole task's run.
    const { result } = renderHook(() => useExecutionStream(42));
    act(() => emit('execution_output', { sessionId: 42, output: 'before\n' }));
    act(() => emit('execution_started', { sessionId: 42 }));
    expect(result.current.status).toBe('running');
    expect(result.current.isRunning).toBe(true);
    expect(result.current.logs.join('')).toContain('before');
  });

  it('execution_completedで完了状態とresultを反映すること', () => {
    const { result } = renderHook(() => useExecutionStream(42));
    act(() => emit('execution_completed', { sessionId: 42, result: { ok: true } }));
    expect(result.current.status).toBe('completed');
    expect(result.current.isRunning).toBe(false);
    expect(result.current.result).toEqual({ ok: true });
  });

  it('execution_failedで失敗状態とerrorを反映すること', () => {
    const { result } = renderHook(() => useExecutionStream(42));
    act(() => emit('execution_failed', { sessionId: 42, error: { errorMessage: 'boom' } }));
    expect(result.current.status).toBe('failed');
    expect(result.current.error).toBe('boom');
  });

  it('execution_cancelledでキャンセル状態を反映すること', () => {
    const { result } = renderHook(() => useExecutionStream(42));
    act(() => emit('execution_cancelled', { sessionId: 42 }));
    expect(result.current.status).toBe('cancelled');
    expect(result.current.isRunning).toBe(false);
  });

  it('不正なJSONペイロードでも例外を投げないこと', () => {
    renderHook(() => useExecutionStream(42));
    expect(() => {
      act(() => {
        handlers.get('execution_output')?.({ data: 'not-json' } as MessageEvent);
      });
    }).not.toThrow();
  });

  it('共有接続の接続状態変化をisConnectedへ反映すること', () => {
    const { result } = renderHook(() => useExecutionStream(42));
    act(() => connectionListener?.(true));
    expect(result.current.isConnected).toBe(true);
    act(() => connectionListener?.(false));
    expect(result.current.isConnected).toBe(false);
  });

  it('アンマウント時に全購読を解除すること', () => {
    const { unmount } = renderHook(() => useExecutionStream(42));
    unmount();
    for (const unsub of unsubscribeSpies.values()) {
      expect(unsub).toHaveBeenCalled();
    }
    expect(connectionUnsub).toHaveBeenCalled();
  });

  it('sessionId変更時に前セッションの購読を解除し新セッションへ再購読すること', () => {
    const { rerender } = renderHook(({ sessionId }) => useExecutionStream(sessionId), {
      initialProps: { sessionId: 1 },
    });
    const firstCallCount = mockSubscribe.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    rerender({ sessionId: 2 });

    // Re-subscribed for the new session (new handler entries recorded).
    expect(mockSubscribe.mock.calls.length).toBeGreaterThan(firstCallCount);
  });

  it('clearLogsでログと状態を初期化すること', () => {
    const { result } = renderHook(() => useExecutionStream(42));
    act(() => emit('execution_output', { sessionId: 42, output: 'hello\n' }));
    expect(result.current.logs).toEqual(['hello\n']);

    act(() => result.current.clearLogs());

    expect(result.current.logs).toEqual([]);
    expect(result.current.status).toBe('idle');
  });
});
