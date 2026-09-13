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
 *   RAPITAS_TEST_CONCURRENCY         Max parallel subprocesses (default: max(1, cpuCount-1))
 *   RAPITAS_TEST_FAILFAST            Set to "1" to stop dispatching new files on first failure
 *   RAPITAS_TEST_RETRY_COUNT         Additional retry attempts on failure (default: 0, disabled)
 *   RAPITAS_TEST_REPORT              Set to "1" to write .rapitas-test-report.json on completion
 *   RAPITAS_TEST_REPORT_PATH         Explicit output path for the test report (implies reporting)
 *   RAPITAS_TEST_ADAPTIVE_RETRY      Set to "1" to enable per-file adaptive retry (default: off)
 *   RAPITAS_TEST_FLAKE_WINDOW        History window size in runs for adaptive retry (default: 10)
 *   RAPITAS_TEST_FLAKE_HIGH_THRESHOLD Flake rate threshold for extra retries (default: 0.2)
 *   RAPITAS_TEST_FLAKE_EXTRA_RETRIES  Extra retries for high-flake files (default: 2)
 *   RAPITAS_TEST_HIGH_FLAKE_PATTERNS  Comma-separated regexes for inherently-flaky test paths
 *   RAPITAS_TEST_FLAKE_HISTORY_PATH   Explicit path for the flake history JSON file
 *   RAPITAS_TEST_SERIAL_PATTERNS     Comma-separated regexes added to the one-at-a-time serial lane
 *
 * Usage:
 *   bun scripts/parallel-test.ts
 *   RAPITAS_TEST_CONCURRENCY=8 bun scripts/parallel-test.ts
 *   RAPITAS_TEST_RETRY_COUNT=2 RAPITAS_TEST_REPORT=1 bun scripts/parallel-test.ts
 *   RAPITAS_TEST_ADAPTIVE_RETRY=1 RAPITAS_TEST_REPORT=1 bun scripts/parallel-test.ts
 */

import { cpus } from 'os';
import { relative, resolve } from 'path';
import { collectTestFiles } from './shuffle-test';
import { writeTestReport } from './test-report';
import type { TestResultEntry } from './test-report';
import {
  parseRetryPolicyConfig,
  resolveFileRetryCount,
  updateFlakeHistory,
  pruneFlakeHistory,
  loadFlakeHistoryOrEmpty,
  saveFlakeHistory,
} from './retry-policy';
import type { FlakeHistoryFile } from './retry-policy';
import {
  SUBPROCESS_HEAVY_TEST_PATTERNS,
  parseSerialPatterns,
  partitionSerialFiles,
  resolveParallelWorkerCount,
} from './serial-lane';
import { formatProgressLine, parseRetryCount, resolveConcurrency } from './parallel-test-utils';

export { formatProgressLine, parseRetryCount, resolveConcurrency };

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

  return {
    file,
    exitCode,
    stdout,
    stderr,
    elapsedMs: performance.now() - start,
  };
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dir, '..');
  const concurrency = resolveConcurrency(process.env.RAPITAS_TEST_CONCURRENCY, cpus().length);
  const failFast = process.env.RAPITAS_TEST_FAILFAST === '1';
  const retryCount = parseRetryCount(process.env.RAPITAS_TEST_RETRY_COUNT);

  const policyConfig = parseRetryPolicyConfig(process.env);
  let flakeHistory: FlakeHistoryFile = {
    version: 1,
    updatedAt: '',
    entries: {},
  };
  if (policyConfig.enabled) {
    flakeHistory = loadFlakeHistoryOrEmpty(root);
  }

  const files = await collectTestFiles(root);

  if (files.length === 0) {
    console.warn('[parallel-test] No test files found — exiting with success.');
    process.exit(0);
  }

  const retryDisplay = policyConfig.enabled
    ? 'retry=adaptive'
    : retryCount > 0
      ? `retry=${retryCount}`
      : '';
  const { parallel: parallelFiles, serial: serialFiles } = partitionSerialFiles(files, [
    ...SUBPROCESS_HEAVY_TEST_PATTERNS,
    ...parseSerialPatterns(process.env.RAPITAS_TEST_SERIAL_PATTERNS),
  ]);
  console.log(
    `[parallel-test] files=${files.length} concurrency=${concurrency} serial=${serialFiles.length}${failFast ? ' fail-fast=ON' : ''}${retryDisplay ? ` ${retryDisplay}` : ''}`,
  );
  const wallStart = performance.now();

  const results: TestResult[] = [];
  const reportResults: TestResultEntry[] = [];
  let completed = 0;
  let firstFailCode = 0;
  const parallelQueue = [...parallelFiles];
  const serialQueue = [...serialFiles];

  /**
   * Worker loop: each worker consumes files from the shared queue sequentially.
   * Multiple workers run concurrently, draining the queue in parallel.
   * NOTE: queue.shift() is race-free because JS is single-threaded — no await
   * between the length check and the shift, so no other worker can interleave.
   * NOTE: Retry happens within the current file before dispatching the next one,
   * so fail-fast only stops new dispatches after all retries for the current file finish.
   */
  async function worker(queue: string[]): Promise<void> {
    while (queue.length > 0) {
      if (failFast && firstFailCode !== 0) break;
      const file = queue.shift();
      if (!file) break;

      const relPath = relative(root, file);
      const fileRetryCount = resolveFileRetryCount(relPath, retryCount, flakeHistory, policyConfig);
      let result = await runFile(file, root);
      let attempts = 1;

      // Retry on failure up to fileRetryCount additional times.
      while (result.exitCode !== 0 && attempts <= fileRetryCount) {
        console.log(`[parallel-test] Retry ${attempts}/${fileRetryCount}: ${relPath}`);
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

  // NOTE: Overlapping real git/bun spawns starve the whole pool on Windows; serialize them.
  const poolSize = resolveParallelWorkerCount(
    concurrency,
    parallelFiles.length,
    serialQueue.length,
  );
  const workers = Array.from({ length: poolSize }, () => worker(parallelQueue));
  if (serialFiles.length > 0) workers.push(worker(serialQueue));
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

  // Update and persist flake history after all workers complete (no concurrency risk here).
  if (policyConfig.enabled) {
    const now = new Date().toISOString();
    const updated = updateFlakeHistory(flakeHistory, reportResults, now);
    const pruned = pruneFlakeHistory(updated, policyConfig.historyWindow);
    saveFlakeHistory(pruned, root);
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
