/**
 * gemini-cli-agent/output-parser ユニットテスト
 *
 * parseStreamEvent（assistant/user/result/system各イベント種別）、
 * formatToolInfo（ツール別フォーマット）、parseArtifacts、parseCommits、
 * isNoiseLine を検証する。
 */
import { describe, test, expect } from 'bun:test';
import {
  parseStreamEvent,
  formatToolInfo,
  parseArtifacts,
  parseCommits,
  isNoiseLine,
} from './output-parser';
import type { GeminiStreamEvent } from './types';

function makeSessionState() {
  return { sessionId: null as string | null, checkpointId: null as string | null };
}

describe('parseStreamEvent', () => {
  test('assistant event with text content appends the text', () => {
    const event: GeminiStreamEvent = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello world' }] },
    };
    const result = parseStreamEvent(event, new Map(), makeSessionState());
    expect(result).toBe('hello world');
  });

  test('assistant event with tool_use registers the tool in activeTools and shows canonical name', () => {
    const event: GeminiStreamEvent = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'ReadFile', id: 'tool-1', input: { file_path: '/a/b.ts' } },
        ],
      },
    };
    const activeTools = new Map();
    const result = parseStreamEvent(event, activeTools, makeSessionState());
    expect(result).toContain('[Tool:');
    expect(result).toContain('-> b.ts');
    expect(activeTools.has('tool-1')).toBe(true);
  });

  test('user event with a successful tool_result reports Tool Done and clears activeTools', () => {
    const activeTools = new Map([
      ['tool-1', { name: 'ReadFile', startTime: Date.now() - 500, info: '' }],
    ]);
    const event: GeminiStreamEvent = {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: false }] },
    };
    const result = parseStreamEvent(event, activeTools, makeSessionState());
    expect(result).toContain('[Tool Done: ReadFile]');
    expect(activeTools.has('tool-1')).toBe(false);
  });

  test('user event with a failed tool_result reports Tool Error', () => {
    const activeTools = new Map([['tool-1', { name: 'Bash', startTime: Date.now(), info: '' }]]);
    const event: GeminiStreamEvent = {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: true }] },
    };
    const result = parseStreamEvent(event, activeTools, makeSessionState());
    expect(result).toContain('[Tool Error: Bash]');
  });

  test('user event referencing an unknown tool_use_id produces no output', () => {
    const event: GeminiStreamEvent = {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'unknown-id' }] },
    };
    const result = parseStreamEvent(event, new Map(), makeSessionState());
    expect(result).toBe('');
  });

  test('result event includes the result text and duration', () => {
    const event: GeminiStreamEvent = {
      type: 'result',
      result: 'All done',
      duration_ms: 2500,
      subtype: 'success',
    };
    const result = parseStreamEvent(event, new Map(), makeSessionState());
    expect(result).toContain('[Result: success (2.5s)]');
    expect(result).toContain('All done');
  });

  test('result event never includes an inline cost figure', () => {
    const event: GeminiStreamEvent = {
      type: 'result',
      result: 'done',
      cost_usd: 0.1234,
    };
    const result = parseStreamEvent(event, new Map(), makeSessionState());
    expect(result).not.toContain('$0.1234');
  });

  test('system event captures session_id and checkpoint_id into sessionState', () => {
    const state = makeSessionState();
    const event: GeminiStreamEvent = {
      type: 'system',
      subtype: 'init',
      session_id: 'sess-1',
      checkpoint_id: 'chk-1',
    };
    parseStreamEvent(event, new Map(), state);
    expect(state.sessionId).toBe('sess-1');
    expect(state.checkpointId).toBe('chk-1');
  });

  test('system init event produces no display output', () => {
    const event: GeminiStreamEvent = { type: 'system', subtype: 'init' };
    const result = parseStreamEvent(event, new Map(), makeSessionState());
    expect(result).toBe('');
  });

  test('system error event produces a System Error line', () => {
    const event: GeminiStreamEvent = { type: 'system', subtype: 'error', error: 'boom' };
    const result = parseStreamEvent(event, new Map(), makeSessionState());
    expect(result).toContain('[System Error: boom]');
  });

  test('system non-init event produces a generic System line', () => {
    const event: GeminiStreamEvent = { type: 'system', subtype: 'other' };
    const result = parseStreamEvent(event, new Map(), makeSessionState());
    expect(result).toContain('[System: other]');
  });
});

describe('formatToolInfo', () => {
  test('returns empty string when input is undefined', () => {
    expect(formatToolInfo('Read', undefined)).toBe('');
  });

  test('formats ReadFile/Read by basename', () => {
    expect(formatToolInfo('Read', { file_path: '/a/b/c.ts' })).toBe('-> c.ts');
  });

  test('formats Glob by pattern', () => {
    expect(formatToolInfo('Glob', { pattern: '**/*.ts' })).toBe('pattern: **/*.ts');
  });

  test('formats Bash, truncating very long commands at 500 chars', () => {
    const longCmd = 'echo ' + 'x'.repeat(600);
    const result = formatToolInfo('Bash', { command: longCmd });
    expect(result.startsWith('$ ')).toBe(true);
    expect(result).toContain('...');
  });

  test('formats a short Bash command without truncation', () => {
    expect(formatToolInfo('Bash', { command: 'ls' })).toBe('$ ls');
  });

  test('formats GoogleSearch by quoted query', () => {
    expect(formatToolInfo('GoogleSearch', { query: 'weather' })).toBe('"weather"');
  });

  test('formats WriteTodos by item count', () => {
    expect(formatToolInfo('WriteTodos', { todos: [1, 2, 3] })).toBe('3 items');
  });

  test('falls back to the first key for unrecognized tool names', () => {
    expect(formatToolInfo('SomeCustomTool', { foo: 'bar' })).toBe('bar');
  });

  test('serializes an object value as JSON in the default case', () => {
    const result = formatToolInfo('SomeCustomTool', { foo: { nested: 1 } });
    expect(result).toBe('{"nested":1}');
  });

  test('truncates a long default value at 80 chars', () => {
    const result = formatToolInfo('SomeCustomTool', { foo: 'y'.repeat(100) });
    expect(result.endsWith('...')).toBe(true);
    expect(result.length).toBe(83);
  });

  test('returns empty string when the default case finds no usable key', () => {
    expect(formatToolInfo('SomeCustomTool', {})).toBe('');
  });
});

describe('parseArtifacts', () => {
  test('detects a "Created" file mention', () => {
    const artifacts = parseArtifacts('Created: src/foo.ts\nsome other text');
    expect(artifacts).toContainEqual(
      expect.objectContaining({ type: 'file', name: 'foo.ts', path: 'src/foo.ts' }),
    );
  });

  test('detects a "File:" mention', () => {
    const artifacts = parseArtifacts('File: src/bar.ts');
    expect(artifacts.some((a) => a.path === 'src/bar.ts')).toBe(true);
  });

  test('ignores a captured path containing "..." (elided/truncated paths)', () => {
    const artifacts = parseArtifacts('Created: src/.../foo.ts');
    expect(artifacts).toHaveLength(0);
  });

  test('detects a fenced diff block as a diff artifact', () => {
    const artifacts = parseArtifacts('```diff\n+added line\n-removed line\n```');
    const diff = artifacts.find((a) => a.type === 'diff');
    expect(diff?.content).toBe('+added line\n-removed line\n');
  });

  test('returns an empty array for output with no matches', () => {
    expect(parseArtifacts('nothing interesting here')).toEqual([]);
  });
});

describe('parseCommits', () => {
  test('detects a "Committed <hash>" mention', () => {
    const commits = parseCommits('Committed abc1234 to main');
    expect(commits[0]?.hash).toBe('abc1234');
  });

  test('detects a "commit <hash>" mention (lowercase, case-insensitive)', () => {
    const commits = parseCommits('commit deadbeef done');
    expect(commits[0]?.hash).toBe('deadbeef');
  });

  test('detects multiple commit hashes in one output', () => {
    const commits = parseCommits('Committed aaa1111\nCommitted bbb2222');
    expect(commits.map((c) => c.hash)).toEqual(['aaa1111', 'bbb2222']);
  });

  test('returns an empty array when there is no commit mention', () => {
    expect(parseCommits('no git activity here')).toEqual([]);
  });
});

describe('isNoiseLine', () => {
  test('treats an empty/whitespace-only line as noise', () => {
    expect(isNoiseLine('   ')).toBe(true);
  });

  test('treats "Active code page:" as noise', () => {
    expect(isNoiseLine('Active code page: 65001')).toBe(true);
  });

  test('treats the Japanese chcp banner as noise', () => {
    expect(isNoiseLine('現在のコード ページ: 932')).toBe(true);
  });

  test('treats a chcp command echo as noise', () => {
    expect(isNoiseLine('chcp 65001')).toBe(true);
  });

  test('does not treat normal output as noise', () => {
    expect(isNoiseLine('Compiling module foo.ts')).toBe(false);
  });
});
