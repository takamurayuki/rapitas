/**
 * execution-file-logger/log-file-builder ユニットテスト
 *
 * buildLogFileContent の5セクション（ヘッダー/サマリー、エラー要約、
 * 警告要約、全ログ、構造化JSON）の組み立てとその省略条件を検証する。
 */
import { describe, test, expect } from 'bun:test';
import { buildLogFileContent } from './log-file-builder';
import type { ExecutionSummary, StructuredLogEntry } from './types';

function makeSummary(overrides: Partial<ExecutionSummary> = {}): ExecutionSummary {
  return {
    executionId: 1,
    sessionId: 2,
    taskId: 3,
    taskTitle: 'Test Task',
    agentType: 'claude-code',
    agentName: 'Claude Code',
    status: 'completed',
    startedAt: '2026-01-01T00:00:00.000Z',
    totalLogEntries: 0,
    errorCount: 0,
    warningCount: 0,
    outputSizeBytes: 0,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<StructuredLogEntry> = {}): StructuredLogEntry {
  return {
    timestamp: '2026-01-01T00:00:01.000Z',
    level: 'INFO',
    eventType: 'output',
    executionId: 1,
    sessionId: 2,
    taskId: 3,
    message: 'hello',
    ...overrides,
  };
}

describe('buildLogFileContent', () => {
  test('includes summary fields in the header section', () => {
    const content = buildLogFileContent(makeSummary({ taskTitle: 'My Task' }), []);
    expect(content).toContain('AGENT EXECUTION LOG');
    expect(content).toContain('Execution ID  : 1');
    expect(content).toContain('Task Title    : My Task');
    expect(content).toContain('Status        : completed');
  });

  test('renders "N/A" for missing completedAt and durationMs', () => {
    const content = buildLogFileContent(makeSummary(), []);
    expect(content).toContain('Completed At  : N/A');
    expect(content).toContain('Duration      : N/A');
  });

  test('formats durationMs as seconds when present', () => {
    const content = buildLogFileContent(makeSummary({ durationMs: 4500 }), []);
    expect(content).toContain('Duration      : 4.5s');
  });

  test('omits Model ID and Tokens Used lines when absent', () => {
    const content = buildLogFileContent(makeSummary(), []);
    expect(content).not.toContain('Model ID');
    expect(content).not.toContain('Tokens Used');
  });

  test('includes Model ID and Tokens Used when present', () => {
    const content = buildLogFileContent(
      makeSummary({ modelId: 'claude-opus-4-5', tokensUsed: 1234 }),
      [],
    );
    expect(content).toContain('Model ID      : claude-opus-4-5');
    expect(content).toContain('Tokens Used   : 1234');
  });

  test('omits the ERROR SUMMARY section when there are no error/fatal entries', () => {
    const content = buildLogFileContent(makeSummary(), [makeEntry({ level: 'INFO' })]);
    expect(content).not.toContain('[ERROR SUMMARY]');
  });

  test('includes an ERROR SUMMARY section for ERROR and FATAL entries', () => {
    const content = buildLogFileContent(makeSummary(), [
      makeEntry({ level: 'ERROR', message: 'first error' }),
      makeEntry({ level: 'FATAL', message: 'fatal error' }),
      makeEntry({ level: 'INFO', message: 'not an error' }),
    ]);
    expect(content).toContain('[ERROR SUMMARY] (2 errors found)');
    expect(content).toContain('--- Error 1 / 2 ---');
    expect(content).toContain('first error');
    expect(content).toContain('--- Error 2 / 2 ---');
    expect(content).toContain('fatal error');
  });

  test('includes error name/message/code/stack when the entry has an error object', () => {
    const content = buildLogFileContent(makeSummary(), [
      makeEntry({
        level: 'ERROR',
        error: { name: 'TypeError', message: 'boom', code: 'E123', stack: 'at foo\nat bar' },
      }),
    ]);
    expect(content).toContain('Error Name    : TypeError');
    expect(content).toContain('Error Message : boom');
    expect(content).toContain('Error Code    : E123');
    expect(content).toContain('Stack Trace   :');
    expect(content).toContain('at foo');
    expect(content).toContain('at bar');
  });

  test('includes serialized context for an error entry', () => {
    const content = buildLogFileContent(makeSummary(), [
      makeEntry({ level: 'ERROR', context: { taskId: 42 } }),
    ]);
    expect(content).toContain('"taskId": 42');
  });

  test('omits the WARNING SUMMARY section when there are no warnings', () => {
    const content = buildLogFileContent(makeSummary(), [makeEntry({ level: 'INFO' })]);
    expect(content).not.toContain('[WARNING SUMMARY]');
  });

  test('includes a WARNING SUMMARY section for WARN entries', () => {
    const content = buildLogFileContent(makeSummary(), [
      makeEntry({ level: 'WARN', message: 'watch out' }),
    ]);
    expect(content).toContain('[WARNING SUMMARY] (1 warnings found)');
    expect(content).toContain('watch out');
  });

  test('always includes the FULL EXECUTION LOG section with entry count', () => {
    const content = buildLogFileContent(makeSummary(), [makeEntry(), makeEntry()]);
    expect(content).toContain('[FULL EXECUTION LOG] (2 entries)');
  });

  test('truncates long DEBUG output messages at 500 chars', () => {
    const longMsg = 'x'.repeat(600);
    const content = buildLogFileContent(makeSummary(), [
      makeEntry({ eventType: 'output', level: 'DEBUG', message: longMsg }),
    ]);
    expect(content).toContain('... (truncated)');
    expect(content).not.toContain('x'.repeat(600));
  });

  test('does not truncate a long non-DEBUG-output message', () => {
    const longMsg = 'y'.repeat(600);
    const content = buildLogFileContent(makeSummary(), [
      makeEntry({ eventType: 'error', level: 'ERROR', message: longMsg }),
    ]);
    expect(content).toContain(longMsg);
  });

  test('includes error name/message and truncated (10-line) stack in the full log entry', () => {
    const manyLineStack = Array.from({ length: 15 }, (_, i) => `  at frame${i}`).join('\n');
    const content = buildLogFileContent(makeSummary(), [
      makeEntry({
        eventType: 'error',
        level: 'ERROR',
        error: { name: 'Err', message: 'bad', stack: manyLineStack },
      }),
    ]);
    // Scope to just the FULL EXECUTION LOG section — the ERROR SUMMARY
    // section above and the STRUCTURED DATA JSON below both intentionally
    // embed the entire, untruncated stack.
    const fullLogSection = content.slice(
      content.indexOf('[FULL EXECUTION LOG]'),
      content.indexOf('[STRUCTURED DATA (JSON)]'),
    );
    expect(fullLogSection).toContain('Error: Err: bad');
    expect(fullLogSection).toContain('frame0');
    expect(fullLogSection).toContain('frame9');
    expect(fullLogSection).not.toContain('frame10');
  });

  test('always includes the STRUCTURED DATA JSON section, valid JSON', () => {
    const content = buildLogFileContent(makeSummary({ executionId: 99 }), [makeEntry()]);
    expect(content).toContain('[STRUCTURED DATA (JSON)]');
    const jsonStart = content.indexOf('{', content.indexOf('[STRUCTURED DATA (JSON)]'));
    const jsonBlock = content.slice(jsonStart);
    const parsed = JSON.parse(jsonBlock);
    expect(parsed.summary.executionId).toBe(99);
    expect(parsed.timeline).toHaveLength(1);
  });
});
