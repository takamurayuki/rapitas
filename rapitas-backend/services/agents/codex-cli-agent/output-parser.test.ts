/**
 * codex-cli-agent/output-parser ユニットテスト
 *
 * parseArtifacts、parseCommits、formatToolInfo（ツール別フォーマット）を
 * 検証する。gemini-cli-agent/output-parser.ts とほぼ同一ロジックの別実装。
 */
import { describe, test, expect } from 'bun:test';
import { parseArtifacts, parseCommits, formatToolInfo } from './output-parser';

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

  test('detects multiple commit hashes in one output', () => {
    const commits = parseCommits('Committed aaa1111\nCommitted bbb2222');
    expect(commits.map((c) => c.hash)).toEqual(['aaa1111', 'bbb2222']);
  });

  test('returns an empty array when there is no commit mention', () => {
    expect(parseCommits('no git activity here')).toEqual([]);
  });
});

describe('formatToolInfo', () => {
  test('returns empty string when input is undefined', () => {
    expect(formatToolInfo('Read', undefined)).toBe('');
  });

  test('formats Read/ReadFile by basename', () => {
    expect(formatToolInfo('Read', { file_path: '/a/b/c.ts' })).toBe('-> c.ts');
  });

  test('formats Glob/FindFiles by pattern', () => {
    expect(formatToolInfo('FindFiles', { pattern: '**/*.ts' })).toBe('pattern: **/*.ts');
  });

  test('formats Bash, truncating long commands at 50 chars', () => {
    const longCmd = 'echo ' + 'x'.repeat(60);
    const result = formatToolInfo('Bash', { command: longCmd });
    expect(result.startsWith('$ ')).toBe(true);
    expect(result).toContain('...');
  });

  test('formats WebSearch by quoted query', () => {
    expect(formatToolInfo('WebSearch', { query: 'weather' })).toBe('"weather"');
  });

  test('formats WebFetch by truncated URL', () => {
    const result = formatToolInfo('WebFetch', { url: 'https://example.com/' + 'a'.repeat(60) });
    expect(result.startsWith('-> ')).toBe(true);
    expect(result).toContain('...');
  });

  test('falls back to the first key for unrecognized tool names', () => {
    expect(formatToolInfo('SomeCustomTool', { foo: 'bar' })).toBe('bar');
  });

  test('serializes an object value as JSON in the default case', () => {
    expect(formatToolInfo('SomeCustomTool', { foo: { nested: 1 } })).toBe('{"nested":1}');
  });

  test('returns empty string when the default case finds no usable key', () => {
    expect(formatToolInfo('SomeCustomTool', {})).toBe('');
  });
});
