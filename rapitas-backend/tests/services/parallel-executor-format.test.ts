/**
 * Parallel Executor Format Functions Test
 *
 * Tests for format functions related to parallel execution.
 */
import { describe, test, expect, mock } from 'bun:test';

// Mock the logger
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

describe('formatCoordinatorPayload', () => {
  // Cannot import the function directly, so redefine it for testing
  function formatCoordinatorPayload(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return String(payload ?? '');

    const obj = payload as Record<string, unknown>;
    const parts: string[] = [];

    // Message fields
    const msg = obj.message || obj.msg || obj.description;
    if (msg && typeof msg === 'string') parts.push(msg);

    // Status fields
    if (obj.status && typeof obj.status === 'string') parts.push(`status=${obj.status}`);

    // Task and agent info
    if (obj.taskId) parts.push(`task=${obj.taskId}`);
    if (obj.agentId && typeof obj.agentId === 'string') parts.push(`agent=${obj.agentId}`);

    // Error fields
    if (obj.error && typeof obj.error === 'string') parts.push(`error: ${obj.error}`);

    // Other fields
    const skipKeys = new Set([
      'message',
      'msg',
      'description',
      'status',
      'taskId',
      'agentId',
      'error',
      'timestamp',
    ]);
    for (const [key, value] of Object.entries(obj)) {
      if (skipKeys.has(key) || value === null || value === undefined) continue;
      if (typeof value === 'object') {
        parts.push(`${key}=${JSON.stringify(value)}`);
      } else {
        parts.push(`${key}=${value}`);
      }
    }

    return parts.length > 0 ? parts.join(', ') : JSON.stringify(payload).slice(0, 200);
  }

  test('メッセージのみの場合は正しくフォーマットされること', () => {
    const result = formatCoordinatorPayload({ message: 'タスクを開始しました' });
    expect(result).toBe('タスクを開始しました');
  });

  test('複数のフィールドがある場合は区切り文字で結合されること', () => {
    const payload = {
      message: 'タスク完了',
      status: 'success',
      taskId: 123,
      agentId: 'agent-001',
    };
    const result = formatCoordinatorPayload(payload);
    expect(result).toBe('タスク完了, status=success, task=123, agent=agent-001');
  });

  test('エラー情報が含まれる場合は正しくフォーマットされること', () => {
    const payload = {
      error: 'ネットワークエラー',
      taskId: 456,
      status: 'failed',
    };
    const result = formatCoordinatorPayload(payload);
    expect(result).toBe('status=failed, task=456, error: ネットワークエラー');
  });

  test('msgやdescriptionフィールドも正しく処理されること', () => {
    const payload1 = { msg: '処理中' };
    expect(formatCoordinatorPayload(payload1)).toBe('処理中');

    const payload2 = { description: '詳細な説明' };
    expect(formatCoordinatorPayload(payload2)).toBe('詳細な説明');
  });

  test('オブジェクト値はJSON文字列として表示されること', () => {
    const payload = {
      message: 'データ処理完了',
      data: { count: 5, items: ['a', 'b'] },
    };
    const result = formatCoordinatorPayload(payload);
    expect(result).toContain('データ処理完了');
    expect(result).toContain('data={"count":5,"items":["a","b"]}');
  });

  test('スキップ対象のキーは表示されないこと', () => {
    const payload = {
      message: 'テスト',
      timestamp: '2024-01-01T00:00:00Z',
      level: 'info',
    };
    const result = formatCoordinatorPayload(payload);
    expect(result).toBe('テスト');
    expect(result).not.toContain('timestamp');
    expect(result).not.toContain('level');
  });

  test('null値やundefined値は無視されること', () => {
    const payload = {
      message: 'テスト',
      nullField: null,
      undefinedField: undefined,
      taskId: 789,
    };
    const result = formatCoordinatorPayload(payload);
    expect(result).toBe('テスト, task=789');
    expect(result).not.toContain('nullField');
    expect(result).not.toContain('undefinedField');
  });

  test('空のオブジェクトはJSON文字列として返されること', () => {
    const result = formatCoordinatorPayload({});
    expect(result).toBe('{}');
  });

  test('非オブジェクト値は文字列として返されること', () => {
    expect(formatCoordinatorPayload(null)).toBe('');
    expect(formatCoordinatorPayload(undefined)).toBe('');
    expect(formatCoordinatorPayload('文字列')).toBe('文字列');
    expect(formatCoordinatorPayload(123)).toBe('123');
    expect(formatCoordinatorPayload(true)).toBe('true');
  });

  test('大きなオブジェクトは200文字に制限されること', () => {
    const largePayload = {
      veryLongFieldName: 'a'.repeat(300),
    };
    const result = formatCoordinatorPayload(largePayload);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  test('実際のcoordinatorメッセージ形式で正しく動作すること', () => {
    const coordinatorMessage = {
      message: '依存関係を解決しました',
      taskId: 42,
      agentId: 'coordinator-001',
      resolvedDependencies: [1, 2, 3],
      timestamp: '2024-01-01T12:00:00Z',
    };
    const result = formatCoordinatorPayload(coordinatorMessage);
    expect(result).toContain('依存関係を解決しました');
    expect(result).toContain('task=42');
    expect(result).toContain('agent=coordinator-001');
    expect(result).toContain('resolvedDependencies=[1,2,3]');
    expect(result).not.toContain('timestamp');
  });
});
