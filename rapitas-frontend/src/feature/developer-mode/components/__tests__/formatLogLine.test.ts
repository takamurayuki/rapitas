/**
 * ExecutionLogViewer formatLogLine and LogMessageTransformer Tests
 */

import { test, describe, expect } from 'vitest';
import {
  transformLogToUserFriendly,
  transformLogsToSimple,
  generateExecutionSummary,
} from '../../utils/log-message-transformer';

// Inline formatLogLine for testing (mirrors ExecutionLogViewer.tsx detailed mode)
function formatLogLine(log: string): { formatted: string; hasJson: boolean } {
  const jsonMatch = log.match(/^(.*?)(\{[\s\S]*\}|\[[\s\S]*\])(.*)$/);
  if (!jsonMatch) return { formatted: log, hasJson: false };

  const [, prefix, jsonStr, suffix] = jsonMatch;
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed !== 'object' || parsed === null) return { formatted: log, hasJson: false };

    const parts: string[] = [];
    const obj = parsed as Record<string, unknown>;
    const priorityKeys = ['message', 'msg', 'status', 'type', 'error', 'taskId', 'agentId'];
    for (const key of priorityKeys) {
      if (key in obj && obj[key] !== null && obj[key] !== undefined) {
        parts.push(`${key}: ${typeof obj[key] === 'object' ? JSON.stringify(obj[key]) : obj[key]}`);
      }
    }
    const skipKeys = new Set([...priorityKeys, 'timestamp', 'level']);
    for (const [key, value] of Object.entries(obj)) {
      if (skipKeys.has(key) || value === null || value === undefined) continue;
      parts.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    }
    return {
      formatted: `${prefix}${parts.join(' | ')}${suffix}`.trim(),
      hasJson: true,
    };
  } catch {
    return { formatted: log, hasJson: false };
  }
}

describe('formatLogLine (detailed mode)', () => {
  test('plain text returned as-is', () => {
    const r = formatLogLine('通常のログメッセージです');
    expect(r.formatted).toBe('通常のログメッセージです');
    expect(r.hasJson).toBe(false);
  });

  test('JSON fields extracted and formatted', () => {
    const r = formatLogLine('Coordinator: {"message":"start","status":"running","taskId":1}');
    expect(r.hasJson).toBe(true);
    expect(r.formatted).toContain('message: start');
    expect(r.formatted).toContain('status: running');
  });

  test('null values excluded', () => {
    const r = formatLogLine('{"message":"test","nullField":null,"status":"ok"}');
    expect(r.hasJson).toBe(true);
    expect(r.formatted).not.toContain('nullField');
  });

  test('priority keys shown first', () => {
    const r = formatLogLine('{"other":"last","message":"first","status":"second"}');
    expect(r.hasJson).toBe(true);
    const mi = r.formatted.indexOf('message: first');
    const oi = r.formatted.indexOf('other: last');
    expect(mi).toBeLessThan(oi);
  });

  test('error info in JSON parsed correctly', () => {
    const r = formatLogLine('Agent: {"error":"connection","taskId":5,"status":"failed"}');
    expect(r.hasJson).toBe(true);
    expect(r.formatted).toContain('error: connection');
  });
});

describe('transformLogToUserFriendly', () => {
  test('tool call translated', () => {
    const r = transformLogToUserFriendly('[Tool: Read] -> index.ts');
    expect(r.category).toBe('info');
    expect(r.message).toContain('読込');
    expect(r.message).toContain('index.ts');
  });

  test('edit tool call translated', () => {
    const r = transformLogToUserFriendly('[Tool: Edit] -> app.tsx');
    expect(r.message).toContain('編集');
  });

  test('bash test command translated', () => {
    const r = transformLogToUserFriendly('[Tool: Bash] $ bun test --run');
    expect(r.category).toBe('progress');
    expect(r.message).toContain('テスト');
  });

  test('git commit translated', () => {
    const r = transformLogToUserFriendly('[Tool: Bash] $ git commit -m "fix"');
    expect(r.message).toContain('コミット');
  });

  test('tool done is tool-result category', () => {
    const r = transformLogToUserFriendly('[Tool Done: Read] (0.3s)');
    expect(r.category).toBe('tool-result');
  });

  test('execution start translated', () => {
    const r = transformLogToUserFriendly('[実行開始] タスクの実行を開始します...');
    expect(r.category).toBe('phase-transition');
  });

  test('empty line is hidden', () => {
    expect(transformLogToUserFriendly('').category).toBe('hidden');
    expect(transformLogToUserFriendly('  ').category).toBe('hidden');
  });

  test('question detected correctly', () => {
    const r = transformLogToUserFriendly('[質問] どのDBを使いますか？');
    expect(r.category).toBe('warning');
    expect(r.message).toContain('質問');
  });

  test('JSON status translated', () => {
    const r = transformLogToUserFriendly('{"status":"running","taskId":5}');
    expect(r.message).toContain('実行中');
  });

  test('plain agent text becomes agent-text category', () => {
    const r = transformLogToUserFriendly(
      'I will now examine the codebase to understand the architecture.',
    );
    expect(r.category).toBe('agent-text');
  });
});

describe('transformLogsToSimple', () => {
  test('multi-line entry split into individual entries', () => {
    const logs = ['[Tool: Read] -> a.ts\n[Tool Done: Read] (0.1s)\n[Tool: Edit] -> b.ts'];
    const result = transformLogsToSimple(logs);
    // Should produce: Read, Tool Done, Edit = 3 entries
    expect(result.length).toBe(3);
    expect(result[0].message).toContain('読込');
    expect(result[2].message).toContain('編集');
  });

  test('consecutive identical entries deduplicated', () => {
    const logs = [
      '[実行開始] タスクの実行を開始します...',
      '[実行開始] タスクの実行を開始します...',
    ];
    const result = transformLogsToSimple(logs);
    expect(result.length).toBe(1);
  });

  test('agent text lines grouped into single block', () => {
    const logs = [
      'Let me analyze the code.\nFirst I will read the file.\nThen I will make changes.',
    ];
    const result = transformLogsToSimple(logs);
    // 3 lines of agent text grouped into 1 entry
    const agentEntries = result.filter((e) => e.category === 'agent-text');
    expect(agentEntries.length).toBe(1);
    expect(agentEntries[0].detail).toContain('First I will read');
  });
});

describe('generateExecutionSummary', () => {
  test('summary from tool calls', () => {
    const logs = [
      '[Tool: Read] -> src/a.ts\n[Tool: Edit] -> src/b.ts\n[Tool: Write] -> src/new.ts\n5 tests passed\n[Tool: Bash] $ git commit -m "fix"\n[Result: completed (15.2s) $0.05]',
    ];
    const s = generateExecutionSummary(logs);
    expect(s).not.toBeNull();
    expect(s!.filesEdited).toHaveLength(1);
    expect(s!.filesCreated).toHaveLength(1);
    expect(s!.filesRead).toHaveLength(1);
    expect(s!.testsPassed).toBe(5);
    expect(s!.commits).toBe(1);
  });

  test('empty logs returns null', () => {
    expect(generateExecutionSummary([])).toBeNull();
  });
});
