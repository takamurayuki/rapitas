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

const { buildTestCorrelationRunRecord, recordTestCorrelationHistory, toCorrelationTestResults } =
  await import('./test-correlation-hook');

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
