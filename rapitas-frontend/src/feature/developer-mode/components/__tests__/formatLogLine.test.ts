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

describe('markdown dump collapsing (transformLogsToSimple)', () => {
  test('raw markdown block collapses into a single expandable summary entry', () => {
    const logs = [
      '調査結果がまとまったので research.md を保存します。\n## 概要\n- 依存関係を調査した\n- 重複実装は見つからなかった\n### テスト戦略\nユニットテストを追加する',
    ];
    const result = transformLogsToSimple(logs);
    const mdEntries = result.filter((e) => e.detail?.includes('## 概要'));
    expect(mdEntries).toHaveLength(1);
    // Summary line names the source file and char count; raw md stays in detail.
    expect(mdEntries[0].message).toContain('research.md');
    expect(mdEntries[0].message).toContain('文字');
    expect(mdEntries[0].message).not.toContain('##');
    expect(mdEntries[0].iconName).toBe('FileText');
    expect(mdEntries[0].detail).toContain('### テスト戦略');
    // Expanded detail renders as a formatted markdown preview, not raw text.
    expect(mdEntries[0].detailFormat).toBe('markdown');
  });

  test('the same md content emitted twice by different sources collapses with a ×2 count', () => {
    const md = '## 検証結果\n- テスト成功\n- 懸念なし\n完了';
    const logs = [`verify.md を保存します\n${md}`, '[Tool: Write] -> verify.md', md];
    const result = transformLogsToSimple(logs);
    const mdEntries = result.filter((e) => e.detailFormat === 'markdown');
    expect(mdEntries).toHaveLength(1);
    expect(mdEntries[0].count).toBe(2);
    expect(mdEntries[0].message).toContain('verify.md');
  });

  test('a markdown dump without a nearby file mention gets the generic summary', () => {
    const logs = ['## Heading\n- bullet one\n- bullet two\nprose line'];
    const result = transformLogsToSimple(logs);
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain('Markdown');
    expect(result[0].detail).toContain('- bullet one');
  });

  test('markdown decorations are stripped from single-line narrative messages', () => {
    const r = transformLogToUserFriendly('**重要**: `config.ts` を確認します');
    expect(r.message).toBe('重要: config.ts を確認します');
  });
});

describe('thinking_tokens spam (dedupe with ×N count)', () => {
  test('52 consecutive [System: thinking_tokens] collapse into ONE quiet entry with count 52', () => {
    const logs = Array.from({ length: 52 }, () => '[System: thinking_tokens]');
    const result = transformLogsToSimple(logs);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('思考中…');
    expect(result[0].category).toBe('progress');
    expect(result[0].count).toBe(52);
  });

  test('generic [System: subtype] events classify as quiet tool-result rows', () => {
    const r = transformLogToUserFriendly('[System: api_retry]');
    expect(r.category).toBe('tool-result');
    expect(r.message).toContain('api_retry');
  });
});

describe('narrative vs mechanical classification', () => {
  test('Japanese reasoning prose is promoted to agent-text (narrative)', () => {
    const r = transformLogToUserFriendly('調査がまとまったので、次はテスト戦略を検討します');
    expect(r.category).toBe('agent-text');
  });

  test('English sentence with terminal punctuation is narrative', () => {
    const r = transformLogToUserFriendly('No delay tracking exists in the current schema.');
    expect(r.category).toBe('agent-text');
  });

  test('mechanical tool lines stay non-narrative', () => {
    expect(transformLogToUserFriendly('[Tool: Bash] $ cd /repo').category).toBe('info');
    expect(transformLogToUserFriendly('[Tool Done: Bash] (0.4s)').category).toBe('tool-result');
  });

  test('stream reads as narrative → actions → narrative with thinking merged', () => {
    const logs = [
      'まずスキーマを確認します。',
      '[System: thinking_tokens]',
      '[System: thinking_tokens]',
      '[Tool: Read] -> schema.prisma',
      '[Tool Done: Read] (0.2s)',
      '遅延トラッキングは存在しないため、新しいカラムを追加します。',
    ];
    const result = transformLogsToSimple(logs);
    expect(result.map((e) => e.category)).toEqual([
      'agent-text',
      'progress',
      'info',
      'tool-result',
      'agent-text',
    ]);
    expect(result[1].count).toBe(2);
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
