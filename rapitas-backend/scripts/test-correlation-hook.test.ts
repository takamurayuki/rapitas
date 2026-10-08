/**
 * test-correlation-hook.test
 *
 * Unit tests for scripts/test-correlation-hook.ts. run-history-store's
 * resolveChangedFiles/appendRunRecord are mocked via mock.module (bun's mock
 * is process-global — this file must be run in isolation, per the repo's
 * parallel-test.ts convention) so no real git diff or disk write occurs.
 *
 * Regression coverage for the fixed defect: recordTestCorrelationHistory
 * must call appendRunRecord exactly once per test run — a prior version
 * duplicated the call site in parallel-test.ts, silently doubling sampleSize
 * in every correlation cell.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { TestResultEntry } from './test-report';

const resolveChangedFiles = mock(() => Promise.resolve({ ok: true, files: ['a.ts'] }));
const appendRunRecord = mock(() => {});
mock.module('../services/analytics/test-correlation/run-history-store', () => ({
  resolveChangedFiles,
  appendRunRecord,
}));

const {
  buildFailureTail,
  buildTestCorrelationRunRecord,
  FAILURE_TAIL_MAX_FILES,
  FAILURE_TAIL_MAX_LINE_CHARS,
  FAILURE_TAIL_MAX_LINES,
  recordTestCorrelationHistory,
  toCorrelationTestResults,
  truncateFailureOutput,
} = await import('./test-correlation-hook');

const REPORT_RESULTS: TestResultEntry[] = [
  { file: 'a.test.ts', elapsedMs: 10, exitCode: 0, attempts: 1, flaky: false },
  { file: 'b.test.ts', elapsedMs: 20, exitCode: 1, attempts: 1, flaky: false },
];

beforeEach(() => {
  resolveChangedFiles.mockClear();
  appendRunRecord.mockClear();
  resolveChangedFiles.mockImplementation(() => Promise.resolve({ ok: true, files: ['a.ts'] }));
});

describe('toCorrelationTestResults', () => {
  test('maps exitCode 0 to pass and non-zero to fail', () => {
    expect(toCorrelationTestResults(REPORT_RESULTS)).toEqual([
      { file: 'a.test.ts', status: 'pass' },
      { file: 'b.test.ts', status: 'fail' },
    ]);
  });
});

describe('buildTestCorrelationRunRecord', () => {
  test('builds a RunRecord with source=ci when isCi is true', () => {
    const record = buildTestCorrelationRunRecord(REPORT_RESULTS, {
      runId: 'run-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      commitSha: 'abc123',
      changedFiles: ['a.ts'],
      isCi: true,
    });
    expect(record).toEqual({
      runId: 'run-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      source: 'ci',
      commitSha: 'abc123',
      changedFiles: ['a.ts'],
      testResults: [
        { file: 'a.test.ts', status: 'pass' },
        { file: 'b.test.ts', status: 'fail' },
      ],
      environment: { platform: process.platform, runtimeVersion: Bun.version },
    });
  });

  test('records failureTail only for failing files that carry one', () => {
    const record = buildTestCorrelationRunRecord(
      [
        { ...REPORT_RESULTS[0], failureTail: ['ignored'] },
        { ...REPORT_RESULTS[1], failureTail: ['FAIL b', 'boom'] },
      ],
      { runId: 'r', timestamp: 't', commitSha: null, changedFiles: [], isCi: false },
    );
    expect(record.failureTail).toEqual({ 'b.test.ts': ['FAIL b', 'boom'] });
  });

  test('builds a RunRecord with source=local when isCi is false', () => {
    const record = buildTestCorrelationRunRecord(REPORT_RESULTS, {
      runId: 'run-2',
      timestamp: '2026-01-01T00:00:00.000Z',
      commitSha: null,
      changedFiles: [],
      isCi: false,
    });
    expect(record.source).toBe('local');
    expect(record.commitSha).toBeNull();
  });
});

describe('recordTestCorrelationHistory', () => {
  test('calls appendRunRecord exactly once per invocation (regression: prior duplicate call site)', async () => {
    await recordTestCorrelationHistory(REPORT_RESULTS, '/fake/root');
    expect(appendRunRecord).toHaveBeenCalledTimes(1);
  });

  test('passes the resolved changed files and CI-derived source into the persisted record', async () => {
    const originalCi = process.env.CI;
    process.env.CI = '1';
    try {
      await recordTestCorrelationHistory(REPORT_RESULTS, '/fake/root');
    } finally {
      if (originalCi === undefined) delete process.env.CI;
      else process.env.CI = originalCi;
    }
    expect(appendRunRecord).toHaveBeenCalledTimes(1);
    const [record, root] = appendRunRecord.mock.calls[0];
    expect(record.changedFiles).toEqual(['a.ts']);
    expect(record.source).toBe('ci');
    expect(root).toBe('/fake/root');
  });

  test('skips recording (does not call appendRunRecord) when resolveChangedFiles fails', async () => {
    resolveChangedFiles.mockImplementation(() => Promise.resolve({ ok: false, files: [] }));
    await recordTestCorrelationHistory(REPORT_RESULTS, '/fake/root');
    expect(appendRunRecord).not.toHaveBeenCalled();
  });

  test('never throws even when appendRunRecord itself throws', async () => {
    appendRunRecord.mockImplementation(() => {
      throw new Error('disk full');
    });
    await expect(
      recordTestCorrelationHistory(REPORT_RESULTS, '/fake/root'),
    ).resolves.toBeUndefined();
  });
});

describe('truncateFailureOutput', () => {
  test('keeps only the last FAILURE_TAIL_MAX_LINES non-empty lines', () => {
    const output = Array.from({ length: FAILURE_TAIL_MAX_LINES + 1 }, (_, i) => `line ${i}`).join(
      '\n',
    );
    const lines = truncateFailureOutput(output);
    expect(lines).toHaveLength(FAILURE_TAIL_MAX_LINES);
    expect(lines[0]).toBe('line 1');
    expect(lines[lines.length - 1]).toBe(`line ${FAILURE_TAIL_MAX_LINES}`);
  });

  test('clips each line to FAILURE_TAIL_MAX_LINE_CHARS characters', () => {
    const lines = truncateFailureOutput('x'.repeat(FAILURE_TAIL_MAX_LINE_CHARS + 1));
    expect(lines[0]).toHaveLength(FAILURE_TAIL_MAX_LINE_CHARS);
  });

  test('drops blank lines and handles CRLF', () => {
    expect(truncateFailureOutput('a\r\n\r\n  \r\nb')).toEqual(['a', 'b']);
  });
});

describe('buildFailureTail', () => {
  test('includes only failing files that have output', () => {
    const tail = buildFailureTail(REPORT_RESULTS, {
      'a.test.ts': 'passed output',
      'b.test.ts': 'boom',
    });
    expect(tail).toEqual({ 'b.test.ts': ['boom'] });
  });

  test('returns undefined when no failing file has output', () => {
    expect(buildFailureTail(REPORT_RESULTS, { 'a.test.ts': 'ok' })).toBeUndefined();
  });

  test('keeps at most FAILURE_TAIL_MAX_FILES failing files', () => {
    const results: TestResultEntry[] = Array.from(
      { length: FAILURE_TAIL_MAX_FILES + 1 },
      (_, i) => ({
        file: `f${i}.test.ts`,
        elapsedMs: 1,
        exitCode: 1,
        attempts: 1,
        flaky: false,
      }),
    );
    const outputs = Object.fromEntries(results.map((r) => [r.file, 'err']));
    const tail = buildFailureTail(results, outputs);
    expect(Object.keys(tail ?? {})).toHaveLength(FAILURE_TAIL_MAX_FILES);
  });
});

describe('recordTestCorrelationHistory failureTail', () => {
  beforeEach(() => {
    appendRunRecord.mockImplementation(() => {});
  });

  test('persists failureTail for failing files and calls appendRunRecord once', async () => {
    await recordTestCorrelationHistory(REPORT_RESULTS, '/fake/root', { 'b.test.ts': 'stack line' });
    expect(appendRunRecord).toHaveBeenCalledTimes(1);
    const [record] = appendRunRecord.mock.calls[0] as unknown as [{ failureTail?: unknown }];
    expect(record.failureTail).toEqual({ 'b.test.ts': ['stack line'] });
  });

  test('omits failureTail entirely when no failing output is available', async () => {
    await recordTestCorrelationHistory(REPORT_RESULTS, '/fake/root');
    const [record] = appendRunRecord.mock.calls[0] as unknown as [Record<string, unknown>];
    expect('failureTail' in record).toBe(false);
  });
});
