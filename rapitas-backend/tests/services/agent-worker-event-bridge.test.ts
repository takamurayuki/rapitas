/**
 * agent-worker event-bridge テスト
 * handleOrchestratorEvent が execution_output に sessionId を含めて
 * ブロードキャストすることを検証する（共有SSE接続でのセッション別フィルタに必要）。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockBroadcast = mock(() => {});

mock.module('../../services/communication/realtime-service', () => ({
  realtimeService: { broadcast: mockBroadcast },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { handleOrchestratorEvent } = await import('../../services/agents/agent-worker/event-bridge');

describe('handleOrchestratorEvent', () => {
  beforeEach(() => {
    mockBroadcast.mockClear();
  });

  test('execution_outputはexecution/sessionチャンネル双方にsessionId付きでブロードキャストすること', () => {
    handleOrchestratorEvent({
      executionId: 100,
      sessionId: 7,
      taskId: 55,
      eventType: 'execution_output',
      timestamp: '2026-01-01T00:00:00.000Z',
      data: { output: 'hello', isError: false },
    });

    expect(mockBroadcast).toHaveBeenCalledTimes(2);
    const [executionChannel, executionType, executionPayload] = mockBroadcast.mock.calls[0]!;
    expect(executionChannel).toBe('execution:100');
    expect(executionType).toBe('execution_output');
    expect(executionPayload).toMatchObject({ executionId: 100, sessionId: 7, output: 'hello' });

    const [sessionChannel, sessionType, sessionPayload] = mockBroadcast.mock.calls[1]!;
    expect(sessionChannel).toBe('session:7');
    expect(sessionType).toBe('execution_output');
    expect(sessionPayload).toMatchObject({ executionId: 100, sessionId: 7, output: 'hello' });
  });

  test('outputデータが無ければブロードキャストしないこと', () => {
    handleOrchestratorEvent({
      executionId: 100,
      sessionId: 7,
      taskId: 55,
      eventType: 'execution_output',
      timestamp: '2026-01-01T00:00:00.000Z',
      data: undefined,
    });

    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  test('execution_startedは既存どおりsessionIdを含めること（回帰防止）', () => {
    handleOrchestratorEvent({
      executionId: 1,
      sessionId: 2,
      taskId: 3,
      eventType: 'execution_started',
      timestamp: '2026-01-01T00:00:00.000Z',
      data: {},
    });

    const [, , payload] = mockBroadcast.mock.calls[0]!;
    expect(payload).toMatchObject({ executionId: 1, sessionId: 2, taskId: 3 });
  });
});
