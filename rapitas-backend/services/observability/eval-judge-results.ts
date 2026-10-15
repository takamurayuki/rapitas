/**
 * Judge Eval Results Snapshot
 *
 * Persists the outcome of `scripts/eval-judge.ts` (the opt-in, live-LLM
 * adversarial-judge accuracy eval) to a single JSON snapshot so the result is
 * visible without re-running the eval or scraping CI logs — the eval only
 * runs when RAPITAS_EVAL_JUDGE=1 is set, so there is no live-CI secret
 * driving this file; it is written locally/manually and read by the metrics
 * UI. Mirrors the RAPITAS_DATA_DIR + never-throw conventions of
 * config/logger.ts and cycle-event-logger.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/** Per-fixture outcome recorded by a single eval run. */
export interface JudgeEvalCaseResult {
  /** Fixture name (from scripts/eval-judge.ts FIXTURES) / フィクスチャ名 */
  name: string;
  /** Verdict the fixture was labelled with / 期待される判定 */
  expected: 'pass' | 'fail';
  /** Verdict the judge actually returned ('unknown' on parse failure) / 実際の判定 */
  got: 'pass' | 'fail' | 'unknown';
  /** Whether got === expected / 一致したか */
  ok: boolean;
}

/** One full judge-eval run, persisted as the latest snapshot. */
export interface JudgeEvalResult {
  /** ISO timestamp the run completed / 実行完了時刻 */
  timestamp: string;
  /** AI provider judged with (claude|gemini|chatgpt) / 使用したプロバイダ */
  provider: string;
  /** Number of fixture cases the judge got right / 正解数 */
  correct: number;
  /** Total fixture cases evaluated / 総数 */
  total: number;
  /** Cases that errored (judge call failed) rather than mismatched / エラー数 */
  errored: number;
  /** correct / total (0 when total is 0) / 正解率 */
  accuracy: number;
  /** Minimum accuracy threshold the run was checked against / 合格しきい値 */
  minAccuracy: number;
  /** accuracy >= minAccuracy / しきい値を満たしたか */
  passed: boolean;
  /** Per-fixture breakdown / フィクスチャ毎の結果 */
  cases: JudgeEvalCaseResult[];
}

/** Directory holding the daily logs (shares RAPITAS_DATA_DIR with the central logger). */
function getLogsDir(): string {
  const override = process.env.RAPITAS_DATA_DIR;
  const base = override && override.trim().length > 0 ? override : join(homedir(), '.rapitas');
  return join(base, 'logs');
}

/**
 * Absolute path of the latest judge-eval snapshot file.
 *
 * @returns Snapshot JSON path / スナップショットファイルのパス
 */
export function getJudgeEvalResultPath(): string {
  return join(getLogsDir(), 'eval-judge-latest.json');
}

/**
 * Overwrites the latest judge-eval snapshot with a new run's result.
 * Never throws — a failed write must not fail the eval script itself.
 *
 * @param result - The completed run's result / 完了した実行結果
 */
export function writeJudgeEvalResult(result: JudgeEvalResult): void {
  try {
    mkdirSync(getLogsDir(), { recursive: true });
    writeFileSync(getJudgeEvalResultPath(), JSON.stringify(result, null, 2), 'utf-8');
  } catch {
    // Observability must never crash the eval it observes.
  }
}

/**
 * Reads the latest judge-eval snapshot. Never throws; returns null when the
 * eval has never run (file missing) or the file is unreadable/corrupt.
 *
 * @returns The latest run's result, or null / 直近の実行結果、なければnull
 */
export function readJudgeEvalResult(): JudgeEvalResult | null {
  try {
    const p = getJudgeEvalResultPath();
    if (!existsSync(p)) return null;
    const raw = readFileSync(p, 'utf-8');
    return JSON.parse(raw) as JudgeEvalResult;
  } catch {
    return null;
  }
}
