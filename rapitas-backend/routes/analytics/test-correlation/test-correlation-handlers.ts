/**
 * test-correlation route handlers
 *
 * Validates input then delegates to services/analytics/test-correlation for
 * the matrix, drilldown, and PR-scan endpoints. `runGh` is DI'd so tests never
 * invoke the real gh CLI (default: services/github/gh-client's runGhCommand).
 */
import { resolve } from 'path';
import { createLogger } from '../../../config/logger';
import { runGhCommand } from '../../../services/github/gh-client';
import { loadFlakeHistoryOrEmpty, computeFlakeRate } from '../../../scripts/retry-policy';
import {
  appendRunRecord,
  buildCorrelationMatrix,
  fetchPrChangedFiles,
  notifyPrTestRisk,
  readRunHistory,
  scorePrRisk,
  type GhRunner,
  type RunRecord,
} from '../../../services/analytics/test-correlation';
import {
  validateDrilldownQuery,
  validateManualRunBody,
  validatePrScanBody,
  validateWindowMonths,
} from './test-correlation-validators';
import type {
  DrilldownResponse,
  ErrorResponse,
  ManualRunResponse,
  MatrixResponse,
  PrScanResponse,
} from './test-correlation.types';

const log = createLogger('routes:test-correlation');

/** Backend root — two levels up from routes/analytics/test-correlation. */
const BACKEND_ROOT = resolve(import.meta.dir, '..', '..', '..');

/**
 * Filters run history to runs within the last `windowMonths`, matching
 * run-history-store.ts's own pruning cutoff logic (受入条件5's time-series filter).
 *
 * @param runs - All persisted runs / 全ランレコード
 * @param windowMonths - Window size in months / フィルタ窓（月）
 * @param now - Reference time / 基準時刻
 * @returns Runs within the window / 窓内のラン一覧
 */
function filterRunsWithinWindow(runs: RunRecord[], windowMonths: number, now: Date): RunRecord[] {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - windowMonths);
  const cutoffMs = cutoff.getTime();
  return runs.filter((r) => {
    const t = Date.parse(r.timestamp);
    return Number.isFinite(t) && t >= cutoffMs;
  });
}

/**
 * Builds a testFile -> flakeRate map from scripts/retry-policy.ts's flake
 * history, per plan.md's decision to reuse the existing flaky-detection
 * source rather than implement a new one (申し送り事項#8).
 *
 * @returns Per-test-file flake rate map / ファイル別フレーク率
 */
function loadFlakeRates(): Record<string, number> {
  const history = loadFlakeHistoryOrEmpty(BACKEND_ROOT);
  const rates: Record<string, number> = {};
  for (const [file, entry] of Object.entries(history.entries)) {
    rates[file] = computeFlakeRate(entry);
  }
  return rates;
}

/**
 * GET /analytics/test-correlation/matrix handler.
 *
 * @param query - Raw query params / クエリパラメータ
 * @returns Matrix response, or an error / マトリックス応答
 */
export function handleGetMatrix(query: Record<string, unknown>): {
  status: number;
  body: MatrixResponse | ErrorResponse;
} {
  const windowResult = validateWindowMonths(query.windowMonths);
  if (!windowResult.ok) {
    return { status: 422, body: { success: false, error: windowResult.error } };
  }

  try {
    const history = readRunHistory(BACKEND_ROOT);
    const windowedRuns = filterRunsWithinWindow(history.runs, windowResult.value, new Date());
    const cells = buildCorrelationMatrix(windowedRuns, { flakeRates: loadFlakeRates() });
    return { status: 200, body: { success: true, windowMonths: windowResult.value, cells } };
  } catch (err) {
    log.error({ err }, 'Failed to build test-correlation matrix');
    return { status: 500, body: { success: false, error: '相関マトリックスの取得に失敗しました' } };
  }
}

/**
 * GET /analytics/test-correlation/drilldown handler.
 *
 * @param query - Raw query params (changedFile, testFile, windowMonths) / クエリパラメータ
 * @returns Drilldown response, or an error / ドリルダウン応答
 */
export function handleGetDrilldown(query: Record<string, unknown>): {
  status: number;
  body: DrilldownResponse | ErrorResponse;
} {
  const validated = validateDrilldownQuery(query);
  if (!validated.ok) {
    return { status: 422, body: { success: false, error: validated.error } };
  }
  const { changedFile, testFile, windowMonths } = validated.value;

  try {
    const history = readRunHistory(BACKEND_ROOT);
    const windowedRuns = filterRunsWithinWindow(history.runs, windowMonths, new Date());
    const flakeRates = loadFlakeRates();
    const isNonDeterministic = (flakeRates[testFile] ?? 0) > 0;

    const entries = windowedRuns
      .filter((run) => run.changedFiles.includes(changedFile))
      .flatMap((run) => {
        const result = run.testResults.find((t) => t.file === testFile);
        if (!result || result.status !== 'fail') return [];
        return [
          {
            runId: run.runId,
            timestamp: run.timestamp,
            commitSha: run.commitSha,
            source: run.source,
            environment: run.environment,
            flaky: isNonDeterministic,
            failureTail: run.failureTail?.[testFile],
          },
        ];
      });

    return { status: 200, body: { success: true, entries } };
  } catch (err) {
    log.error({ err }, 'Failed to build test-correlation drilldown');
    return { status: 500, body: { success: false, error: '失敗事例の取得に失敗しました' } };
  }
}

/**
 * POST /analytics/test-correlation/pr-scan handler.
 *
 * @param body - Raw request body / リクエストボディ
 * @param cwd - Repo working directory for the gh CLI / gh 実行ディレクトリ
 * @param runGh - Injectable gh runner (default: real gh CLI) / gh 実行関数
 * @returns PR-scan response, or an error / スキャン応答
 */
export async function handlePostPrScan(
  body: Record<string, unknown>,
  cwd: string = BACKEND_ROOT,
  runGh: GhRunner = runGhCommand,
): Promise<{ status: number; body: PrScanResponse | ErrorResponse }> {
  const validated = validatePrScanBody(body);
  if (!validated.ok) {
    return { status: 422, body: { success: false, error: validated.error } };
  }
  const { prNumber, prUrl, windowMonths, notify } = validated.value;

  try {
    const changedFiles = await fetchPrChangedFiles(cwd, prNumber, runGh);
    const history = readRunHistory(BACKEND_ROOT);
    const windowedRuns = filterRunsWithinWindow(history.runs, windowMonths, new Date());
    const matrix = buildCorrelationMatrix(windowedRuns, { flakeRates: loadFlakeRates() });
    const entries = scorePrRisk(changedFiles, matrix);

    let notified = false;
    if (notify) {
      await notifyPrTestRisk(prNumber, entries, prUrl);
      notified = true;
    }

    return { status: 200, body: { success: true, prNumber, entries, notified } };
  } catch (err) {
    log.error({ err }, 'Failed to run PR test-risk scan');
    return { status: 500, body: { success: false, error: 'PRスキャンに失敗しました' } };
  }
}

/**
 * POST /analytics/test-correlation/manual-run handler.
 *
 * `source` is always hardcoded to 'manual' — the request body cannot specify
 * it — and `runId`/`timestamp` are server-generated, mirroring
 * scripts/test-correlation-hook.ts's responsibility split (client supplies
 * only result data; identifiers/timestamps are the server's responsibility).
 *
 * @param body - Raw request body / リクエストボディ
 * @param backendRoot - Backend root for the history store (DI for tests) / バックエンドルート
 * @returns Manual-run response, or an error / 手動テスト結果登録応答
 */
export function handlePostManualRun(
  body: Record<string, unknown>,
  backendRoot: string = BACKEND_ROOT,
): { status: number; body: ManualRunResponse | ErrorResponse } {
  const validated = validateManualRunBody(body);
  if (!validated.ok) {
    return { status: 422, body: { success: false, error: validated.error } };
  }
  const { changedFiles, testResults, commitSha, environment } = validated.value;

  try {
    const runId = crypto.randomUUID();
    const record: RunRecord = {
      runId,
      timestamp: new Date().toISOString(),
      source: 'manual',
      commitSha: commitSha ?? null,
      changedFiles,
      testResults,
      environment: {
        platform: environment?.platform ?? 'manual',
        runtimeVersion: environment?.runtimeVersion ?? 'n/a',
      },
    };
    appendRunRecord(record, backendRoot);
    return { status: 200, body: { success: true, runId } };
  } catch (err) {
    log.error({ err }, 'Failed to record manual test run');
    return { status: 500, body: { success: false, error: '手動テスト結果の記録に失敗しました' } };
  }
}
