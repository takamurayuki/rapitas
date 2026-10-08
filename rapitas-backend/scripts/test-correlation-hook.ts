/**
 * test-correlation-hook
 *
 * Bridges parallel-test.ts's own TestResultEntry[] shape into a RunRecord and
 * persists it via services/analytics/test-correlation/run-history-store.ts.
 * Split out of parallel-test.ts to keep that file's line count from growing
 * (it was already over the soft file-size limit before this task).
 */
import {
  appendRunRecord,
  resolveChangedFiles,
} from '../services/analytics/test-correlation/run-history-store';
import type {
  RunRecord,
  TestResultEntry as CorrelationTestResultEntry,
} from '../services/analytics/test-correlation/test-correlation.types';
import type { TestResultEntry } from './test-report';

/**
 * Base git ref to diff against when resolving changed files for the
 * test-correlation history hook. HEAD~1 approximates "what this commit
 * changed" for both local runs and CI (works for shallow clones of depth ≥ 2).
 */
export const TEST_CORRELATION_BASE_REF = process.env.RAPITAS_TEST_CORRELATION_BASE_REF ?? 'HEAD~1';

export const FAILURE_TAIL_MAX_FILES = 20;
export const FAILURE_TAIL_MAX_LINES = 40;
export const FAILURE_TAIL_MAX_LINE_CHARS = 300;

/**
 * Keeps only the last lines of a failing file's output, each clipped in length,
 * so the stored record stays bounded regardless of how verbose the test was.
 *
 * @param output - Combined stdout/stderr of one failing test file / 失敗ファイルの出力
 * @returns Truncated lines, oldest first / 切り詰めた行一覧
 */
export function truncateFailureOutput(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(-FAILURE_TAIL_MAX_LINES)
    .map((line) => line.slice(0, FAILURE_TAIL_MAX_LINE_CHARS));
}

/**
 * Builds the bounded failureTail map for failing files only. Passing files are
 * excluded, and at most FAILURE_TAIL_MAX_FILES entries are kept in report order.
 *
 * @param reportResults - This run's per-file results / このランのファイル別結果
 * @param outputs - Combined output keyed by relative file path / ファイル別の出力
 * @returns failureTail map, or undefined when no failing file has output / 失敗ファイルの出力マップ
 */
export function buildFailureTail(
  reportResults: TestResultEntry[],
  outputs: Record<string, string>,
): Record<string, string[]> | undefined {
  const tail: Record<string, string[]> = {};
  for (const r of reportResults) {
    if (Object.keys(tail).length >= FAILURE_TAIL_MAX_FILES) break;
    if (r.exitCode === 0) continue;
    const output = outputs[r.file];
    if (!output) continue;
    const lines = truncateFailureOutput(output);
    if (lines.length > 0) tail[r.file] = lines;
  }
  return Object.keys(tail).length > 0 ? tail : undefined;
}

/**
 * Converts parallel-test.ts's own TestResultEntry[] into the test-correlation
 * service's TestResultEntry[] shape (skip is not modeled by parallel-test.ts,
 * so every entry maps to pass/fail by exit code).
 *
 * @param reportResults - This run's per-file results / このランのファイル別結果
 * @returns Correlation-service test result entries / 相関サービス用のテスト結果一覧
 */
export function toCorrelationTestResults(
  reportResults: TestResultEntry[],
): CorrelationTestResultEntry[] {
  return reportResults.map((r) => ({
    file: r.file,
    status: r.exitCode === 0 ? 'pass' : 'fail',
  }));
}

/**
 * Builds the RunRecord persisted by the test-correlation history hook.
 * Pure function — no I/O — so the run-history conversion can be unit tested
 * without spawning git or writing to disk.
 *
 * @param reportResults - This run's per-file results / このランのファイル別結果
 * @param opts - runId/timestamp/commitSha/changedFiles/isCi supplied by the caller / 呼び出し元が渡す文脈情報
 * @returns Run record ready for appendRunRecord / 記録用のランレコード
 */
export function buildTestCorrelationRunRecord(
  reportResults: TestResultEntry[],
  opts: {
    runId: string;
    timestamp: string;
    commitSha: string | null;
    changedFiles: string[];
    isCi: boolean;
    failureTail?: Record<string, string[]>;
  },
): RunRecord {
  const entryTail: Record<string, string[]> = {};
  for (const r of reportResults) {
    if (r.exitCode !== 0 && r.failureTail && r.failureTail.length > 0) {
      entryTail[r.file] = r.failureTail;
    }
  }
  const failureTail = { ...entryTail, ...(opts.failureTail ?? {}) };
  return {
    runId: opts.runId,
    timestamp: opts.timestamp,
    source: opts.isCi ? 'ci' : 'local',
    commitSha: opts.commitSha,
    changedFiles: opts.changedFiles,
    testResults: toCorrelationTestResults(reportResults),
    environment: { platform: process.platform, runtimeVersion: Bun.version },
    ...(Object.keys(failureTail).length > 0 ? { failureTail } : {}),
  };
}

/**
 * Records this run's results into the test-correlation history store.
 * NOTE: Every failure mode (git diff failure, git rev-parse failure, store
 * write failure) is caught and logged as a warning — this hook must never
 * affect the test run's exit code or throw past this function.
 *
 * @param reportResults - This run's per-file results / このランのファイル別結果
 * @param root - Backend root, used as git cwd and history storage root / バックエンドルート
 * @param outputs - Combined output of each test file keyed by relative path / ファイル別の出力
 */
export async function recordTestCorrelationHistory(
  reportResults: TestResultEntry[],
  root: string,
  outputs: Record<string, string> = {},
): Promise<void> {
  try {
    const diffResult = await resolveChangedFiles(TEST_CORRELATION_BASE_REF, root);
    if (!diffResult.ok) {
      // NOTE: resolveChangedFiles already warn-logged the underlying failure;
      // per plan.md's edge-case policy we skip recording rather than persist
      // a misleading "zero files changed" run.
      return;
    }

    let commitSha: string | null = null;
    try {
      const proc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      commitSha = code === 0 ? out.trim() : null;
    } catch (err) {
      console.warn(`[test-correlation-hook] Failed to resolve commit SHA: ${String(err)}`);
    }

    const record = buildTestCorrelationRunRecord(reportResults, {
      runId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      commitSha,
      changedFiles: diffResult.files,
      isCi: !!process.env.CI,
      failureTail: buildFailureTail(reportResults, outputs),
    });
    appendRunRecord(record, root);
  } catch (err) {
    console.warn(
      `[test-correlation-hook] Failed to record test-correlation history: ${String(err)}`,
    );
  }
}
