/**
 * ExecutionLogViewer formatLogLine Function Test
 * ログ行のJSONフォーマット機能のテスト
 */

import { test, describe, expect } from '@jest/globals';

// formatLogLine関数をテスト用に抽出
function formatLogLine(log: string): { formatted: string; hasJson: boolean } {
  // JSON文字列を含むかチェック（{...} または [...] パターン）
  const jsonMatch = log.match(/^(.*?)(\{[\s\S]*\}|\[[\s\S]*\])(.*)$/);
  if (!jsonMatch) return { formatted: log, hasJson: false };

  const [, prefix, jsonStr, suffix] = jsonMatch;
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed !== 'object' || parsed === null) {
      return { formatted: log, hasJson: false };
    }

    // オブジェクトをkey: value形式で整形
    const parts: string[] = [];
    const obj = parsed as Record<string, unknown>;

    // よく使うフィールドを先に表示
    const priorityKeys = [
      'message',
      'msg',
      'status',
      'type',
      'error',
      'taskId',
      'agentId',
    ];
    for (const key of priorityKeys) {
      if (key in obj && obj[key] !== null && obj[key] !== undefined) {
        parts.push(
          `${key}: ${typeof obj[key] === 'object' ? JSON.stringify(obj[key]) : obj[key]}`,
        );
      }
    }

    // 残りのフィールド
    const skipKeys = new Set([...priorityKeys, 'timestamp', 'level']);
    for (const [key, value] of Object.entries(obj)) {
      if (skipKeys.has(key) || value === null || value === undefined) continue;
      parts.push(
        `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`,
      );
    }

    const formattedJson = parts.join(' | ');
    return {
      formatted: `${prefix}${formattedJson}${suffix}`.trim(),
      hasJson: true,
    };
  } catch {
    return { formatted: log, hasJson: false };
  }
}

describe('formatLogLine', () => {
  test('通常のテキストログはそのまま返されること', () => {
    const result = formatLogLine('通常のログメッセージです');
    expect(result.formatted).toBe('通常のログメッセージです');
    expect(result.hasJson).toBe(false);
  });

  test('JSON文字列を含むログが正しくフォーマットされること', () => {
    const jsonLog =
      'Coordinator: {"message":"タスクを開始","status":"running","taskId":123}';
    const result = formatLogLine(jsonLog);

    expect(result.hasJson).toBe(true);
    expect(result.formatted).toContain('message: タスクを開始');
    expect(result.formatted).toContain('status: running');
    expect(result.formatted).toContain('taskId: 123');
  });

  test('メッセージのみのJSONは正しく処理されること', () => {
    const jsonLog = '{"message":"処理完了"}';
    const result = formatLogLine(jsonLog);

    expect(result.hasJson).toBe(true);
    expect(result.formatted).toBe('message: 処理完了');
  });

  test('複数フィールドを持つJSONが正しく整形されること', () => {
    const jsonLog =
      '{"message":"実行中","status":"active","type":"coordination","progress":75}';
    const result = formatLogLine(jsonLog);

    expect(result.hasJson).toBe(true);
    expect(result.formatted).toContain('message: 実行中');
    expect(result.formatted).toContain('status: active');
    expect(result.formatted).toContain('type: coordination');
    expect(result.formatted).toContain('progress: 75');
    expect(result.formatted).toContain(' | ');
  });

  test('エラー情報を含むJSONが正しく処理されること', () => {
    const jsonLog =
      '[Agent] {"error":"接続エラー","taskId":456,"status":"failed"}';
    const result = formatLogLine(jsonLog);

    expect(result.hasJson).toBe(true);
    expect(result.formatted).toContain('[Agent]');
    expect(result.formatted).toContain('error: 接続エラー');
    expect(result.formatted).toContain('taskId: 456');
    expect(result.formatted).toContain('status: failed');
  });

  test('null値やundefined値は無視されること', () => {
    const jsonLog = '{"message":"テスト","nullField":null,"status":"ok"}';
    const result = formatLogLine(jsonLog);

    expect(result.hasJson).toBe(true);
    expect(result.formatted).toContain('message: テスト');
    expect(result.formatted).toContain('status: ok');
    expect(result.formatted).not.toContain('nullField');
  });

  test('priorityKeysが優先的に表示されること', () => {
    const jsonLog =
      '{"other":"後回し","message":"優先","another":"これも後","status":"優先2"}';
    const result = formatLogLine(jsonLog);

    expect(result.hasJson).toBe(true);
    const formatted = result.formatted;
    const messageIndex = formatted.indexOf('message: 優先');
    const statusIndex = formatted.indexOf('status: 優先2');
    const otherIndex = formatted.indexOf('other: 後回し');

    expect(messageIndex).toBeLessThan(otherIndex);
    expect(statusIndex).toBeLessThan(otherIndex);
  });
});
