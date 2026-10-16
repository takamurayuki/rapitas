/**
 * test-report.test.ts
 *
 * Unit tests for scripts/test-report.ts.
 * Covers: getTestReportPath, writeTestReport (all JSON shape variants).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getTestReportPath, writeTestReport } from './test-report';
import type { TestResultEntry, TestReportRaw } from './test-report';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(file: string, exitCode: number, attempts = 1, flaky = false): TestResultEntry {
  return { file, elapsedMs: 100, exitCode, attempts, flaky };
}

// ─── getTestReportPath ────────────────────────────────────────────────────────

describe('getTestReportPath', () => {
  let savedReport: string | undefined;
  let savedReportPath: string | undefined;
  let savedDataDir: string | undefined;

  beforeEach(() => {
    savedReport = process.env.RAPITAS_TEST_REPORT;
    savedReportPath = process.env.RAPITAS_TEST_REPORT_PATH;
    savedDataDir = process.env.RAPITAS_DATA_DIR;
    delete process.env.RAPITAS_TEST_REPORT;
    delete process.env.RAPITAS_TEST_REPORT_PATH;
    delete process.env.RAPITAS_DATA_DIR;
  });

  afterEach(() => {
    if (savedReport === undefined) delete process.env.RAPITAS_TEST_REPORT;
    else process.env.RAPITAS_TEST_REPORT = savedReport;
    if (savedReportPath === undefined) delete process.env.RAPITAS_TEST_REPORT_PATH;
    else process.env.RAPITAS_TEST_REPORT_PATH = savedReportPath;
    if (savedDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = savedDataDir;
  });

  test('uses RAPITAS_TEST_REPORT_PATH when set (highest priority)', () => {
    process.env.RAPITAS_TEST_REPORT_PATH = '/custom/path/report.json';
    process.env.RAPITAS_DATA_DIR = '/should/be/ignored';
    expect(getTestReportPath('/backend')).toBe('/custom/path/report.json');
  });

  test('uses RAPITAS_DATA_DIR when RAPITAS_TEST_REPORT_PATH is unset', () => {
    process.env.RAPITAS_DATA_DIR = '/data';
    const result = getTestReportPath('/backend');
    expect(result).toBe(join('/data', '.rapitas-test-report.json'));
  });

  test('falls back to backendRoot when neither env is set', () => {
    const result = getTestReportPath('/backend');
    expect(result).toBe(join('/backend', '.rapitas-test-report.json'));
  });
});

// ─── writeTestReport ─────────────────────────────────────────────────────────

describe('writeTestReport', () => {
  let tmpDir: string;
  let savedReport: string | undefined;
  let savedReportPath: string | undefined;
  let savedDataDir: string | undefined;

  beforeEach(() => {
    savedReport = process.env.RAPITAS_TEST_REPORT;
    savedReportPath = process.env.RAPITAS_TEST_REPORT_PATH;
    savedDataDir = process.env.RAPITAS_DATA_DIR;
    tmpDir = mkdtempSync(join(tmpdir(), 'test-report-'));
    delete process.env.RAPITAS_TEST_REPORT;
    delete process.env.RAPITAS_TEST_REPORT_PATH;
    delete process.env.RAPITAS_DATA_DIR;
  });

  afterEach(() => {
    if (savedReport === undefined) delete process.env.RAPITAS_TEST_REPORT;
    else process.env.RAPITAS_TEST_REPORT = savedReport;
    if (savedReportPath === undefined) delete process.env.RAPITAS_TEST_REPORT_PATH;
    else process.env.RAPITAS_TEST_REPORT_PATH = savedReportPath;
    if (savedDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
    else process.env.RAPITAS_DATA_DIR = savedDataDir;
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('returns null and writes no file when reporting is disabled', () => {
    const result = writeTestReport([], 0, '2025-01-01T00:00:00Z', tmpDir);
    expect(result).toBeNull();
  });

  test('returns null when RAPITAS_TEST_REPORT is "0"', () => {
    process.env.RAPITAS_TEST_REPORT = '0';
    const result = writeTestReport([], 0, '2025-01-01T00:00:00Z', tmpDir);
    expect(result).toBeNull();
  });

  test('writes file and returns path when RAPITAS_TEST_REPORT=1', () => {
    process.env.RAPITAS_TEST_REPORT = '1';
    const entries = [makeEntry('tests/a.test.ts', 0)];
    const path = writeTestReport(entries, 5000, '2025-01-01T00:00:00Z', tmpDir);
    expect(path).not.toBeNull();
    expect(path).toContain('.rapitas-test-report.json');
  });

  test('writes file when RAPITAS_TEST_REPORT_PATH is set', () => {
    const reportPath = join(tmpDir, 'custom-report.json');
    process.env.RAPITAS_TEST_REPORT_PATH = reportPath;
    const result = writeTestReport([], 0, '2025-01-01T00:00:00Z', tmpDir);
    expect(result).toBe(reportPath);
  });

  test('all-pass report has correct summary', () => {
    process.env.RAPITAS_TEST_REPORT = '1';
    const entries = [makeEntry('a.test.ts', 0), makeEntry('b.test.ts', 0)];
    const path = writeTestReport(entries, 2000, '2025-01-01T00:00:00Z', tmpDir)!;
    const report = JSON.parse(readFileSync(path, 'utf-8')) as TestReportRaw;
    expect(report.summary.total).toBe(2);
    expect(report.summary.passed).toBe(2);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.flaky).toBe(0);
    expect(report.summary.retries).toBe(0);
  });

  test('failure report reflects failed count', () => {
    process.env.RAPITAS_TEST_REPORT = '1';
    const entries = [makeEntry('a.test.ts', 0), makeEntry('b.test.ts', 1)];
    const path = writeTestReport(entries, 3000, '2025-01-01T00:00:00Z', tmpDir)!;
    const report = JSON.parse(readFileSync(path, 'utf-8')) as TestReportRaw;
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(1);
  });

  test('flaky report counts retried-then-passed files', () => {
    process.env.RAPITAS_TEST_REPORT = '1';
    const entries = [
      makeEntry('a.test.ts', 0, 2, true), // flaky: failed once, passed on retry
      makeEntry('b.test.ts', 0, 1, false), // clean pass
    ];
    const path = writeTestReport(entries, 4000, '2025-01-01T00:00:00Z', tmpDir)!;
    const report = JSON.parse(readFileSync(path, 'utf-8')) as TestReportRaw;
    expect(report.summary.flaky).toBe(1);
    expect(report.summary.retries).toBe(1); // 1 extra attempt total
  });

  test('empty results produce valid report with zero counts', () => {
    process.env.RAPITAS_TEST_REPORT = '1';
    const path = writeTestReport([], 0, '2025-01-01T00:00:00Z', tmpDir)!;
    const report = JSON.parse(readFileSync(path, 'utf-8')) as TestReportRaw;
    expect(report.summary.total).toBe(0);
    expect(report.summary.passed).toBe(0);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.flaky).toBe(0);
    expect(report.summary.retries).toBe(0);
    expect(report.results).toHaveLength(0);
  });

  test('report includes generatedAt and wallClockMs', () => {
    process.env.RAPITAS_TEST_REPORT = '1';
    const path = writeTestReport([], 9999, '2025-06-24T10:00:00Z', tmpDir)!;
    const report = JSON.parse(readFileSync(path, 'utf-8')) as TestReportRaw;
    expect(report.generatedAt).toBe('2025-06-24T10:00:00Z');
    expect(report.wallClockMs).toBe(9999);
  });

  test('report results preserve all entry fields', () => {
    process.env.RAPITAS_TEST_REPORT = '1';
    const entry = makeEntry('tests/x.test.ts', 0, 3, true);
    entry.elapsedMs = 1234;
    const path = writeTestReport([entry], 1234, '2025-01-01T00:00:00Z', tmpDir)!;
    const report = JSON.parse(readFileSync(path, 'utf-8')) as TestReportRaw;
    expect(report.results[0]).toMatchObject({
      file: 'tests/x.test.ts',
      exitCode: 0,
      attempts: 3,
      flaky: true,
      elapsedMs: 1234,
    });
  });
});
