#!/usr/bin/env bun
/**
 * parallel-test.ts
 *
 * Runs backend unit test files in parallel using OS process isolation to prevent
 * bun mock.module process-global contamination from spreading across test files.
 * Each file is executed as a separate `bun test --isolate <file>` subprocess;
 * stdout/stderr is buffered per file and flushed atomically on completion.
 * Integration tests are excluded via INTEGRATION_EXCLUDE_PATTERN from shuffle-test.ts.
 *
 * Environment variables:
 *   RAPITAS_TEST_CONCURRENCY    Max parallel subprocesses (default: max(1, cpuCount-1))
 *   RAPITAS_TEST_FAILFAST       Set to "1" to stop dispatching new files on first failure
 *   RAPITAS_TEST_RETRY_COUNT    Additional retry attempts on failure (default: 0, disabled)
 *   RAPITAS_TEST_REPORT         Set to "1" to write .rapitas-test-report.json on completion
 *   RAPITAS_TEST_REPORT_PATH    Explicit output path for the test report (implies reporting)
 *
 * Usage:
 *   bun scripts/parallel-test.ts
 *   RAPITAS_TEST_CONCURRENCY=8 bun scripts/parallel-test.ts
 *   RAPITAS_TEST_RETRY_COUNT=2 RAPITAS_TEST_REPORT=1 bun scripts/parallel-test.ts
 */

import { cpus } from 'os';
import { relative, resolve } from 'path';
import { collectTestFiles } from './shuffle-test';
import { writeTestReport } from './test-report';
import type { TestResultEntry } from './test-report';

/** Completed result for a single test file subprocess. */
export interface TestResult {
  /** Absolute path to the test file. */
  file: string;
  /** Process exit code; 0 = pass. */
  exitCode: number;
  /** Buffered stdout from the subprocess. */
  stdout: string;
  /** Buffered stderr from the subprocess. */
  stderr: string;
  /** Wall-clock elapsed time in milliseconds. */
  elapsedMs: number;
}

/**
 * Parses RAPITAS_TEST_RETRY_COUNT into a non-negative integer retry count.
 * Returns 0 (disabled) for undefined, empty, non-numeric, negative, or Infinity input.
 *
 * @param envValue - Raw RAPITAS_TEST_RETRY_COUNT value / 環境変数の生の値
 * @returns Non-negative integer number of additional retry attempts (0 = no retry)
 */
export function parseRetryCount(envValue: string | undefined): number {
  if (envValue === undefined || envValue === '') return 0;
  const parsed = parseInt(envValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

/**
 * Resolves the max concurrent subprocess count from env or CPU count.
 *
 * @param envValue - Raw RAPITAS_TEST_CONCURRENCY value / 環境変数の生の値
 * @param cpuCount - Number of logical CPU cores / 論理CPUコア数
 * @returns Positive integer concurrency limit (minimum 1)
 */
export function resolveConcurrency(envValue: string | undefined, cpuCount: number): number {
  if (envValue !== undefined && envValue !== '') {
    const parsed = parseInt(envValue, 10);
    // NOTE: Infinity parses as a finite value check fails, so it correctly falls back to 1.
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return 1;
  }
  return Math.max(1, cpuCount - 1);
}

/**
 * Computes the final process exit code by returning the first non-zero code seen.
 * Negative codes are normalised to 1.
 *
 * @param results - Completed test results / 完了したテスト結果の配列
 * @returns 0 if all passed; first non-zero exit code (min 1) otherwise
 */
export function aggregateExitCode(results: TestResult[]): number {
  for (const r of results) {
    if (r.exitCode !== 0) return r.exitCode > 0 ? r.exitCode : 1;
  }
  return 0;
}

/**
 * Formats a one-line progress entry for a completed test file.
 *
 * @param index - 1-based completion count / 完了順の1始まり番号
 * @param total - Total test file count / テストファイルの総数
 * @param passed - true if exit code was 0 / 合格判定
 * @param relPath - Relative path from backend root / バックエンドルートからの相対パス
 * @param elapsedMs - Elapsed wall-clock time / 経過時間（ミリ秒）
 * @returns Formatted "[i/N] PASS|FAIL <relPath> (Xms)" string
 */
export function formatProgressLine(
  index: number,
  total: number,
  passed: boolean,
  relPath: string,
  elapsedMs: number,
): string {
  return `[${index}/${total}] ${passed ? 'PASS' : 'FAIL'} ${relPath} (${elapsedMs.toFixed(0)}ms)`;
}

/**
 * Runs one test file in a subprocess and returns the buffered result.
 * Spawn failure is reported as exit code 1 rather than throwing.
 *
 * @param file - Absolute path of the test file / テストファイルの絶対パス
 * @param root - Backend root used as subprocess cwd / サブプロセスの作業ディレクトリ
 * @returns Resolved TestResult after the subprocess exits
 */
export async function runFile(file: string, root: string): Promise<TestResult> {
  const start = performance.now();
  let proc: ReturnType<typeof Bun.spawn<'ignore', 'pipe', 'pipe'>>;
  try {
    // NOTE: File is passed as a separate array element — avoids shell injection / quoting issues.
    // --isolate: double-protection on top of bunfig.toml's `isolate = true`.
    proc = Bun.spawn(['bun', 'test', '--isolate', file], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
  } catch (err) {
    return {
      file,
      exitCode: 1,
      stdout: '',
      stderr: `[parallel-test] Spawn failed: ${String(err)}\n`,
      elapsedMs: performance.now() - start,
    };
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { file, exitCode, stdout, stderr, elapsedMs: performance.now() - start };
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dir, '..');
  const concurrency = resolveConcurrency(process.env.RAPITAS_TEST_CONCURRENCY, cpus().length);
  const failFast = process.env.RAPITAS_TEST_FAILFAST === '1';
  const retryCount = parseRetryCount(process.env.RAPITAS_TEST_RETRY_COUNT);

  const files = await collectTestFiles(root);

  if (files.length === 0) {
    console.warn('[parallel-test] No test files found — exiting with success.');
    process.exit(0);
  }

  console.log(
    `[parallel-test] files=${files.length} concurrency=${concurrency}${failFast ? ' fail-fast=ON' : ''}${retryCount > 0 ? ` retry=${retryCount}` : ''}`,
  );
  const wallStart = performance.now();

  const results: TestResult[] = [];
  const reportResults: TestResultEntry[] = [];
  let completed = 0;
  let firstFailCode = 0;
  const queue = [...files];

  /**
   * Worker loop: each worker consumes files from the shared queue sequentially.
   * Multiple workers run concurrently, draining the queue in parallel.
   * NOTE: queue.shift() is race-free because JS is single-threaded — no await
   * between the length check and the shift, so no other worker can interleave.
   * NOTE: Retry happens within the current file before dispatching the next one,
   * so fail-fast only stops new dispatches after all retries for the current file finish.
   */
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      if (failFast && firstFailCode !== 0) break;
      const file = queue.shift();
      if (!file) break;

      const relPath = relative(root, file);
      let result = await runFile(file, root);
      let attempts = 1;

      // Retry on failure up to retryCount additional times.
      while (result.exitCode !== 0 && attempts <= retryCount) {
        console.log(`[parallel-test] Retry ${attempts}/${retryCount}: ${relPath}`);
        result = await runFile(file, root);
        attempts++;
      }

      const flaky = result.exitCode === 0 && attempts > 1;

      completed++;
      const passed = result.exitCode === 0;
      console.log(formatProgressLine(completed, files.length, passed, relPath, result.elapsedMs));

      // Flush buffered output atomically for this file immediately on completion.
      if (result.stdout.trim() || result.stderr.trim()) {
        console.log(`\n--- ${relPath} ---`);
        if (result.stdout.trim()) process.stdout.write(result.stdout);
        if (result.stderr.trim()) process.stderr.write(result.stderr);
      }

      results.push(result);
      reportResults.push({
        file: relPath,
        elapsedMs: result.elapsedMs,
        exitCode: result.exitCode,
        attempts,
        flaky,
      });

      if (!passed && firstFailCode === 0) {
        firstFailCode = result.exitCode > 0 ? result.exitCode : 1;
      }
    }
  }

  // Launch min(concurrency, files.length) workers; each drains the shared queue.
  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker());
  await Promise.all(workers);

  const wallMs = performance.now() - wallStart;
  const failedResults = results.filter((r) => r.exitCode !== 0);
  const passedCount = results.length - failedResults.length;

  console.log('\n' + '='.repeat(60));
  console.log(
    `[parallel-test] ${passedCount} passed, ${failedResults.length} failed in ${(wallMs / 1000).toFixed(1)}s`,
  );

  if (failedResults.length > 0) {
    console.log('\n[parallel-test] FAILED FILES:');
    for (const r of failedResults) {
      console.log(`  ✗ ${relative(root, r.file)}`);
    }
    console.log('\n[parallel-test] FAILED OUTPUT:');
    for (const r of failedResults) {
      const relPath = relative(root, r.file);
      console.log(`\n=== FAIL: ${relPath} ===`);
      if (r.stdout.trim()) process.stdout.write(r.stdout);
      if (r.stderr.trim()) process.stderr.write(r.stderr);
    }
  }

  // Write test report if enabled via env (RAPITAS_TEST_REPORT=1 or RAPITAS_TEST_REPORT_PATH).
  const reportPath = writeTestReport(reportResults, wallMs, new Date().toISOString(), root);
  if (reportPath) {
    console.log(`[parallel-test] Test report written to: ${reportPath}`);
  }

  process.exit(aggregateExitCode(results));
}

// NOTE: Guard prevents main() from running when this file is imported by unit tests.
if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error('[parallel-test] Fatal error:', err);
    process.exit(1);
  });
}
