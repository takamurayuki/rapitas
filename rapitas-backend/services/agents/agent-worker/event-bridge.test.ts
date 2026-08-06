/**
 * Tests for agent-worker event-bridge
 *
 * Covers handleWorkerMessage's dispatch branches (worker-ready, worker-shutting-down,
 * response, orchestrator-event, unknown type, and the top-level error guard) and
 * handleOrchestratorEvent's per-eventType broadcastMulti fan-out (one delivery per client).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { PendingRequest } from './ipc';

const mockBroadcastMulti = mock(() => {});
const mockLoggerInfo = mock(() => {});
const mockLoggerWarn = mock(() => {});
const mockLoggerError = mock(() => {});
const mockLoggerDebug = mock(() => {});

mock.module('../../communication/realtime-service', () => ({
  realtimeService: { broadcastMulti: mockBroadcastMulti },
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: mockLoggerDebug,
  }),
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: mockLoggerDebug,
  },
  getBackendLogFilePath: () => 'C:/tmp/backend.log',
}));

const { handleWorkerMessage, handleOrchestratorEvent } = await import('./event-bridge');

describe('handleWorkerMessage', () => {
  beforeEach(() => {
    mockBroadcastMulti.mockClear();
    mockLoggerInfo.mockClear();
    mockLoggerWarn.mockClear();
    mockLoggerError.mockClear();
    mockLoggerDebug.mockClear();
  });

  it('worker-ready をライフサイクルコールバック onReady に転送すること', () => {
    const onReady = mock(() => {});
    const onShuttingDown = mock(() => {});

    handleWorkerMessage({ type: 'worker-ready', data: { pid: 4242 } }, new Map(), {
      onReady,
      onShuttingDown,
    });

    expect(onReady).toHaveBeenCalledWith(4242);
    expect(onShuttingDown).not.toHaveBeenCalled();
  });

  it('worker-shutting-down をライフサイクルコールバック onShuttingDown に転送すること', () => {
    const onReady = mock(() => {});
    const onShuttingDown = mock(() => {});

    handleWorkerMessage({ type: 'worker-shutting-down', data: { signal: 'SIGTERM' } }, new Map(), {
      onReady,
      onShuttingDown,
    });

    expect(onShuttingDown).toHaveBeenCalledWith('SIGTERM');
    expect(onReady).not.toHaveBeenCalled();
  });

  it('response を pendingRequests 経由で解決すること', () => {
    const resolve = mock(() => {});
    const reject = mock(() => {});
    const pendingRequests = new Map<string, PendingRequest>([
      ['req-1', { resolve, reject, timeout: setTimeout(() => {}, 100000), type: 'x' }],
    ]);

    handleWorkerMessage(
      { type: 'response', data: { id: 'req-1', success: true, data: { ok: true } } },
      pendingRequests,
      { onReady: mock(() => {}), onShuttingDown: mock(() => {}) },
    );

    expect(resolve).toHaveBeenCalledWith({ ok: true });
    expect(reject).not.toHaveBeenCalled();
    expect(pendingRequests.has('req-1')).toBe(false);
  });

  it('orchestrator-event を handleOrchestratorEvent にディスパッチしブロードキャストすること', () => {
    handleWorkerMessage(
      {
        type: 'orchestrator-event',
        data: {
          executionId: 1,
          sessionId: 2,
          taskId: 3,
          eventType: 'execution_started',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      },
      new Map(),
      { onReady: mock(() => {}), onShuttingDown: mock(() => {}) },
    );

    expect(mockBroadcastMulti).toHaveBeenCalledTimes(1);
  });

  it('未知の type は warn ログのみでコールバックを呼ばないこと', () => {
    const onReady = mock(() => {});
    const onShuttingDown = mock(() => {});

    handleWorkerMessage({ type: 'something-else', data: {} }, new Map(), {
      onReady,
      onShuttingDown,
    });

    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
    expect(onShuttingDown).not.toHaveBeenCalled();
    expect(mockBroadcastMulti).not.toHaveBeenCalled();
  });

  it('不正なメッセージ（null）でも例外を投げず error ログに落ちること', () => {
    expect(() =>
      handleWorkerMessage(null as unknown as Record<string, unknown>, new Map(), {
        onReady: mock(() => {}),
        onShuttingDown: mock(() => {}),
      }),
    ).not.toThrow();

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
  });
});

describe('handleOrchestratorEvent', () => {
  beforeEach(() => {
    mockBroadcastMulti.mockClear();
    mockLoggerDebug.mockClear();
  });

  const baseFields = {
    executionId: 10,
    sessionId: 20,
    taskId: 30,
    timestamp: '2026-01-01T00:00:00.000Z',
  };

  it('execution_started は execution/session 両チャンネルへブロードキャストすること', () => {
    handleOrchestratorEvent({ ...baseFields, eventType: 'execution_started', data: {} });

    expect(mockBroadcastMulti).toHaveBeenCalledTimes(1);
    expect(mockBroadcastMulti.mock.calls[0]).toEqual([
      ['execution:10', 'session:20'],
      'execution_started',
      expect.objectContaining({ executionId: 10, sessionId: 20, taskId: 30 }),
    ]);
  });

  it('execution_output はデータがあれば両チャンネルへブロードキャストすること', () => {
    handleOrchestratorEvent({
      ...baseFields,
      eventType: 'execution_output',
      data: { output: 'hello', isError: false },
    });

    expect(mockBroadcastMulti).toHaveBeenCalledTimes(1);
    expect(mockBroadcastMulti.mock.calls[0]![2]).toMatchObject({ output: 'hello', isError: false });
  });

  it('execution_output はデータが無ければブロードキャストしないこと', () => {
    handleOrchestratorEvent({ ...baseFields, eventType: 'execution_output', data: undefined });

    expect(mockBroadcastMulti).not.toHaveBeenCalled();
  });

  it('execution_completed は result に data を積んでブロードキャストすること', () => {
    handleOrchestratorEvent({
      ...baseFields,
      eventType: 'execution_completed',
      data: { success: true },
    });

    expect(mockBroadcastMulti.mock.calls[0]![2]).toMatchObject({ result: { success: true } });
  });

  it('execution_failed は error に data を積んでブロードキャストすること', () => {
    handleOrchestratorEvent({
      ...baseFields,
      eventType: 'execution_failed',
      data: { message: 'boom' },
    });

    expect(mockBroadcastMulti.mock.calls[0]![2]).toMatchObject({ error: { message: 'boom' } });
  });

  it('execution_cancelled をブロードキャストすること', () => {
    handleOrchestratorEvent({ ...baseFields, eventType: 'execution_cancelled', data: undefined });

    expect(mockBroadcastMulti).toHaveBeenCalledTimes(1);
    expect(mockBroadcastMulti.mock.calls[0]![1]).toBe('execution_cancelled');
  });

  it('未対応の eventType は debug ログのみでブロードキャストしないこと', () => {
    handleOrchestratorEvent({ ...baseFields, eventType: 'unknown_thing', data: {} });

    expect(mockBroadcastMulti).not.toHaveBeenCalled();
    expect(mockLoggerDebug).toHaveBeenCalledTimes(1);
  });
});
