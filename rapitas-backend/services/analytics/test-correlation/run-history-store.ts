/**
 * run-history-store
 *
 * JSON-file persistence for test-correlation run history, modelled on
 * scripts/retry-policy.ts's I/O pattern: RAPITAS_DATA_DIR-first path
 * resolution, fail-open on read/write errors, and a prune step to bound
 * storage. Does NOT depend on Prisma — all state lives in a local JSON file.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { createLogger } from '../../../config/logger';
import type { RunHistoryFile, RunRecord } from './test-correlation.types';

const log = createLogger('services:test-correlation:run-history-store');

/** Max run records retained regardless of age (safety valve against unbounded growth). */
export const MAX_RUN_RECORDS = 5000;

/** Retention window in months — matches the correlation matrix's default filter window. */
export const RETENTION_WINDOW_MONTHS = 3;

const EMPTY_HISTORY: RunHistoryFile = { version: 1, runs: [] };

/**
 * Returns the absolute path to the run history JSON file.
 * Priority: RAPITAS_TEST_CORRELATION_HISTORY_PATH → RAPITAS_DATA_DIR → backendRoot.
 *
 * @param backendRoot - Absolute path to the backend root / バックエンドルートの絶対パス
 * @returns Absolute path to the history file / 履歴ファイルの絶対パス
 */
export function getRunHistoryPath(backendRoot: string): string {
  const explicit = process.env.RAPITAS_TEST_CORRELATION_HISTORY_PATH;
  if (explicit) return explicit;
  const filename = 'test-correlation-run-history.json';
  const dataDir = process.env.RAPITAS_DATA_DIR;
  if (dataDir) return join(dataDir, filename);
  return join(backendRoot, filename);
}

/**
 * Reads the run history JSON file, returning an empty history on missing or
 * parse failure. Never throws; errors are surfaced via the shared logger.
 *
 * @param backendRoot - Absolute path to the backend root / バックエンドルートの絶対パス
 * @returns Parsed history, or empty history on any read error / 履歴またはエラー時は空履歴
 */
export function readRunHistory(backendRoot: string): RunHistoryFile {
  const path = getRunHistoryPath(backendRoot);
  try {
    if (!existsSync(path)) return EMPTY_HISTORY;
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as RunHistoryFile;
    if (!parsed || !Array.isArray(parsed.runs)) return EMPTY_HISTORY;
    return parsed;
  } catch (err) {
    log.warn({ err, path }, 'Failed to load run history');
    return EMPTY_HISTORY;
  }
}

/**
 * Writes the run history to disk via atomic write (temp file + rename) so a
 * crash mid-write never leaves a truncated/corrupt file for concurrent
 * `parallel-test.ts` workers to read. Failures are logged but never throw.
 *
 * @param history - History to persist / 書き込む履歴
 * @param backendRoot - Absolute path to the backend root / バックエンドルートの絶対パス
 */
export function writeRunHistory(history: RunHistoryFile, backendRoot: string): void {
  const path = getRunHistoryPath(backendRoot);
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmpPath, JSON.stringify(history, null, 2), 'utf-8');
    renameSync(tmpPath, path);
  } catch (err) {
    log.warn({ err, path }, 'Failed to save run history');
  }
}

/**
 * Removes run records older than the retention window and caps the total
 * count at MAX_RUN_RECORDS (keeping the most recent). Does not mutate input.
 *
 * @param history - History to prune / プルーニング対象履歴
 * @param now - Reference time for the age cutoff / 基準時刻
 * @param windowMonths - Retention window in months / 保持期間（月）
 * @returns Pruned history / プルーニング後の履歴
 */
export function pruneRunHistory(
  history: RunHistoryFile,
  now: Date,
  windowMonths: number = RETENTION_WINDOW_MONTHS,
): RunHistoryFile {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - windowMonths);
  const cutoffMs = cutoff.getTime();

  const withinWindow = history.runs.filter((r) => {
    const t = Date.parse(r.timestamp);
    return Number.isFinite(t) && t >= cutoffMs;
  });

  // NOTE: Sorted ascending by timestamp before slicing so the *most recent*
  // MAX_RUN_RECORDS survive, not an arbitrary prefix.
  withinWindow.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const capped =
    withinWindow.length > MAX_RUN_RECORDS ? withinWindow.slice(-MAX_RUN_RECORDS) : withinWindow;

  return { version: 1, runs: capped };
}

/**
 * Appends a single run record to the history, prunes it, and persists it.
 * Read-modify-write is not safe under true concurrency, but parallel-test.ts
 * calls this exactly once after all subprocess workers have finished, so
 * there is no concurrent writer in the intended call site.
 *
 * @param record - Run record to append / 追加するランレコード
 * @param backendRoot - Absolute path to the backend root / バックエンドルートの絶対パス
 * @param now - Reference time for pruning / プルーニング基準時刻
 */
export function appendRunRecord(
  record: RunRecord,
  backendRoot: string,
  now: Date = new Date(),
): void {
  const current = readRunHistory(backendRoot);
  const appended: RunHistoryFile = { version: 1, runs: [...current.runs, record] };
  const pruned = pruneRunHistory(appended, now);
  writeRunHistory(pruned, backendRoot);
}

/** Injectable git-diff runner, mirroring pr-risk-features.ts's GhRunner DI pattern. */
export type DiffRunner = (args: string[], cwd: string) => Promise<string>;

/**
 * Default DiffRunner backed by a real `git` subprocess.
 *
 * @param args - git CLI arguments / git 引数
 * @param cwd - Working directory / 作業ディレクトリ
 * @returns Trimmed stdout / 標準出力（トリム済み）
 * @throws {Error} When git exits non-zero / git が非0終了した場合
 */
export function defaultDiffRunner(args: string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolvePromise(stdout.trim());
      else reject(new Error(`git ${args.join(' ')} exited with code ${code}: ${stderr}`));
    });
  });
}

/** Result of resolveChangedFiles — distinguishes "genuinely no files changed" from "git failed". */
export interface ResolveChangedFilesResult {
  /** False when the git invocation itself failed (caller must skip recording this run). */
  ok: boolean;
  files: string[];
}

/**
 * Resolves the list of files changed relative to a base ref via `git diff --name-only`.
 * On any failure (detached HEAD with no base, shallow clone missing the ref, git not
 * found, etc.), returns `{ ok: false, files: [] }` and logs a warning — this must never
 * throw, so a telemetry failure can't stop the test run itself. Per plan.md's edge-case
 * policy, callers must skip persisting the run record entirely when ok is false, rather
 * than recording a misleading "zero files changed" run.
 *
 * @param baseRef - Base ref to diff against, e.g. "HEAD~1" / 差分の基準ref
 * @param cwd - Working directory for git / git 実行ディレクトリ
 * @param runDiff - Injectable git runner (DI for tests) / git 実行関数
 * @returns ok=false with empty files on failure; ok=true with the (possibly empty) changed file list otherwise
 */
export async function resolveChangedFiles(
  baseRef: string,
  cwd: string,
  runDiff: DiffRunner = defaultDiffRunner,
): Promise<ResolveChangedFilesResult> {
  try {
    const out = await runDiff(['diff', '--name-only', `${baseRef}...HEAD`], cwd);
    const files = out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return { ok: true, files };
  } catch (err) {
    log.warn({ err, baseRef }, 'Failed to resolve changed files');
    return { ok: false, files: [] };
  }
}
