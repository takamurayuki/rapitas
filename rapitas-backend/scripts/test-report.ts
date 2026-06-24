/**
 * test-report.ts
 *
 * Provides writeTestReport() and TestReportRaw type for JSON test report output.
 * Report is written only when RAPITAS_TEST_REPORT=1 or RAPITAS_TEST_REPORT_PATH is set.
 * Consumed by parallel-test.ts at the end of a test run.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

/** Single file result entry with retry metadata, stored in the report. */
export interface TestResultEntry {
  /** Path relative to the backend root directory. */
  file: string;
  /** Wall-clock elapsed time in milliseconds (last attempt). */
  elapsedMs: number;
  /** Process exit code of the final attempt; 0 = pass. */
  exitCode: number;
  /** Total attempts made (1 = ran once with no retry). */
  attempts: number;
  /** True when the file failed at least once but ultimately passed via retry. */
  flaky: boolean;
}

/** Raw JSON structure written by writeTestReport. */
export interface TestReportRaw {
  /** ISO timestamp of report generation. */
  generatedAt: string;
  /** Total wall-clock time for the entire run in ms. */
  wallClockMs: number;
  /** Aggregate summary counts. */
  summary: {
    /** Total number of test files processed. */
    total: number;
    /** Files that passed (exitCode 0 on final attempt). */
    passed: number;
    /** Files that failed (exitCode ≠ 0 on final attempt). */
    failed: number;
    /** Files that are flaky (failed ≥ 1 time but ultimately passed). */
    flaky: number;
    /** Total retry executions across all files (attempts - 1, summed). */
    retries: number;
  };
  /** Per-file results with attempt metadata. */
  results: TestResultEntry[];
}

/**
 * Returns the absolute path for the test report JSON file.
 * Priority: RAPITAS_TEST_REPORT_PATH env → RAPITAS_DATA_DIR/<name> → backendRoot/<name>.
 *
 * @param backendRoot - Absolute path to the backend root directory / バックエンドルートの絶対パス
 * @returns Absolute path for the report file
 */
export function getTestReportPath(backendRoot: string): string {
  const explicit = process.env.RAPITAS_TEST_REPORT_PATH;
  if (explicit) return explicit;
  const filename = '.rapitas-test-report.json';
  const dataDir = process.env.RAPITAS_DATA_DIR;
  if (dataDir) return join(dataDir, filename);
  return join(backendRoot, filename);
}

/**
 * Writes a test report JSON file when reporting is enabled via environment.
 * No-op (returns null) when neither RAPITAS_TEST_REPORT=1 nor RAPITAS_TEST_REPORT_PATH is set.
 *
 * @param results - Per-file results with attempt metadata / ファイル別テスト結果
 * @param wallClockMs - Total wall-clock elapsed time in ms / 合計経過時間（ミリ秒）
 * @param generatedAt - ISO timestamp string for the report / 生成時刻ISO文字列
 * @param backendRoot - Backend root for default path resolution / デフォルトパス解決用バックエンドルート
 * @returns Absolute path of the written file, or null if reporting is disabled
 */
export function writeTestReport(
  results: TestResultEntry[],
  wallClockMs: number,
  generatedAt: string,
  backendRoot: string,
): string | null {
  const enabled =
    process.env.RAPITAS_TEST_REPORT === '1' || !!process.env.RAPITAS_TEST_REPORT_PATH;
  if (!enabled) return null;

  const passed = results.filter((r) => r.exitCode === 0).length;
  const failed = results.length - passed;
  const flaky = results.filter((r) => r.flaky).length;
  const retries = results.reduce((sum, r) => sum + Math.max(0, r.attempts - 1), 0);

  const report: TestReportRaw = {
    generatedAt,
    wallClockMs,
    summary: { total: results.length, passed, failed, flaky, retries },
    results,
  };

  const reportPath = getTestReportPath(backendRoot);
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  return reportPath;
}
