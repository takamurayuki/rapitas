/**
 * retry-policy
 *
 * Adaptive per-file retry policy for parallel-test.ts.
 * Accumulates flake history across runs in a JSON file and resolves
 * per-file retry counts: high-flake files get extra retries; stable files get 0.
 * Does NOT depend on Prisma — all state lives in a local JSON file.
 *
 * Opt-in via RAPITAS_TEST_ADAPTIVE_RETRY=1. When unset, all callers that
 * respect the `enabled` flag behave identically to the previous global-retry approach.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { TestResultEntry } from './test-report';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Rolling-window flake record for a single test file. */
export interface FlakeHistoryEntry {
  /** Number of run records accumulated (capped to historyWindow after pruning). */
  runCount: number;
  /** Number of those runs where the file was flaky (failed ≥ 1 time but ultimately passed). */
  flakeCount: number;
  /** ISO timestamp of the last update — reserved for future TTL-based pruning. */
  lastSeenAt: string;
}

/** JSON structure persisted by saveFlakeHistory. */
export interface FlakeHistoryFile {
  /** Schema version — bump on breaking changes. */
  version: 1;
  /** ISO timestamp of last save. */
  updatedAt: string;
  /** Per-file flake records; keys are paths relative to the backend root. */
  entries: Record<string, FlakeHistoryEntry>;
}

/** Resolved configuration for the adaptive retry policy. */
export interface RetryPolicyConfig {
  /** True when RAPITAS_TEST_ADAPTIVE_RETRY=1. */
  enabled: boolean;
  /** Rolling window size in runs (RAPITAS_TEST_FLAKE_WINDOW, default: 10). */
  historyWindow: number;
  /**
   * Files with flakeRate >= this threshold receive extra retries
   * (RAPITAS_TEST_FLAKE_HIGH_THRESHOLD, default: 0.2).
   */
  highThreshold: number;
  /** Additional retries granted to high-flake files (RAPITAS_TEST_FLAKE_EXTRA_RETRIES, default: 2). */
  flakeExtraRetries: number;
  /**
   * Compiled patterns from RAPITAS_TEST_HIGH_FLAKE_PATTERNS (comma-separated regexes).
   * Files matching any pattern are treated as high-flake regardless of history.
   */
  highFlakePatterns: RegExp[];
}

// ─── Config parsing ──────────────────────────────────────────────────────────

/**
 * Parses the adaptive retry policy configuration from environment variables.
 * Invalid values are silently replaced with defaults so a typo can't break CI.
 *
 * @param env - Environment variable map / 環境変数マップ
 * @returns Resolved RetryPolicyConfig / 解決済み設定
 */
export function parseRetryPolicyConfig(env: NodeJS.ProcessEnv): RetryPolicyConfig {
  const enabled = env.RAPITAS_TEST_ADAPTIVE_RETRY === '1';

  const rawWindow = parseInt(env.RAPITAS_TEST_FLAKE_WINDOW ?? '', 10);
  const historyWindow = Number.isFinite(rawWindow) && rawWindow > 0 ? rawWindow : 10;

  const rawThreshold = parseFloat(env.RAPITAS_TEST_FLAKE_HIGH_THRESHOLD ?? '');
  const highThreshold =
    Number.isFinite(rawThreshold) && rawThreshold >= 0 && rawThreshold <= 1 ? rawThreshold : 0.2;

  const rawExtra = parseInt(env.RAPITAS_TEST_FLAKE_EXTRA_RETRIES ?? '', 10);
  const flakeExtraRetries = Number.isFinite(rawExtra) && rawExtra >= 0 ? rawExtra : 2;

  const highFlakePatterns: RegExp[] = [];
  const rawPatterns = env.RAPITAS_TEST_HIGH_FLAKE_PATTERNS;
  if (rawPatterns) {
    for (const raw of rawPatterns.split(',')) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      try {
        highFlakePatterns.push(new RegExp(trimmed));
      } catch {
        // NOTE: Invalid regex silently skipped to prevent a typo from breaking CI.
        console.warn(
          `[retry-policy] Invalid regex in RAPITAS_TEST_HIGH_FLAKE_PATTERNS: "${trimmed}" — skipped`,
        );
      }
    }
  }

  return { enabled, historyWindow, highThreshold, flakeExtraRetries, highFlakePatterns };
}

// ─── Pure computation ────────────────────────────────────────────────────────

/**
 * Computes the flake rate for a single history entry.
 * Returns 0 when runCount is 0 to guard against division by zero.
 *
 * @param entry - Flake history entry / フレーク履歴エントリ
 * @returns Flake rate in [0, 1] / フレーク率
 */
export function computeFlakeRate(entry: FlakeHistoryEntry): number {
  if (entry.runCount === 0) return 0;
  return entry.flakeCount / entry.runCount;
}

/**
 * Resolves the retry count for a single test file based on its flake history and config.
 *
 * Decision order:
 * 1. adaptive disabled → globalRetry
 * 2. file matches a highFlakePattern → globalRetry + flakeExtraRetries
 * 3. no history entry → globalRetry
 * 4. flakeRate >= highThreshold → globalRetry + flakeExtraRetries
 * 5. flakeRate === 0 AND runCount >= historyWindow → 0 (known stable)
 * 6. otherwise → globalRetry
 *
 * @param file - Relative path of the test file / テストファイルの相対パス
 * @param globalRetry - Baseline retry count from RAPITAS_TEST_RETRY_COUNT / グローバルリトライ数
 * @param history - Current flake history / フレーク履歴
 * @param config - Adaptive retry config / 設定
 * @returns Per-file retry count / ファイル別リトライ数
 */
export function resolveFileRetryCount(
  file: string,
  globalRetry: number,
  history: FlakeHistoryFile,
  config: RetryPolicyConfig,
): number {
  if (!config.enabled) return globalRetry;

  if (config.highFlakePatterns.some((re) => re.test(file))) {
    return globalRetry + config.flakeExtraRetries;
  }

  const entry = history.entries[file];
  if (!entry) return globalRetry;

  const rate = computeFlakeRate(entry);

  if (rate >= config.highThreshold) return globalRetry + config.flakeExtraRetries;

  // NOTE: Only mark as stable once the window is full; too few data points risk
  // a single lucky clean run setting retries to 0 on an actually flaky file.
  if (rate === 0 && entry.runCount >= config.historyWindow) return 0;

  return globalRetry;
}

/**
 * Returns a new FlakeHistoryFile updated with results from a completed test run.
 * Does NOT mutate the input; returns a new object.
 *
 * @param prev - Existing history / 既存のフレーク履歴
 * @param results - Test results from the just-completed run / 今回の実行結果
 * @param now - ISO timestamp string for the update / 更新タイムスタンプ
 * @returns Updated history / 更新済みフレーク履歴
 */
export function updateFlakeHistory(
  prev: FlakeHistoryFile,
  results: TestResultEntry[],
  now: string,
): FlakeHistoryFile {
  const entries: Record<string, FlakeHistoryEntry> = { ...prev.entries };

  for (const result of results) {
    const existing = entries[result.file];
    if (existing) {
      entries[result.file] = {
        runCount: existing.runCount + 1,
        flakeCount: existing.flakeCount + (result.flaky ? 1 : 0),
        lastSeenAt: now,
      };
    } else {
      entries[result.file] = {
        runCount: 1,
        flakeCount: result.flaky ? 1 : 0,
        lastSeenAt: now,
      };
    }
  }

  return { version: 1, updatedAt: now, entries };
}

/**
 * Returns a new FlakeHistoryFile with runCounts capped to the window size.
 * flakeCounts are scaled proportionally to preserve flake rate.
 * Does NOT mutate the input.
 *
 * @param history - History to prune / プルーニング対象履歴
 * @param window - Maximum run count per file / ファイルごとの最大記録回数
 * @returns Pruned history / プルーニング後の履歴
 */
export function pruneFlakeHistory(history: FlakeHistoryFile, window: number): FlakeHistoryFile {
  const entries: Record<string, FlakeHistoryEntry> = {};

  for (const [file, entry] of Object.entries(history.entries)) {
    if (entry.runCount <= window) {
      entries[file] = entry;
    } else {
      // NOTE: Math.round to keep flakeCount an integer; max 1-unit rounding error is acceptable.
      entries[file] = {
        runCount: window,
        flakeCount: Math.round((entry.flakeCount * window) / entry.runCount),
        lastSeenAt: entry.lastSeenAt,
      };
    }
  }

  return { ...history, entries };
}

// ─── I/O ────────────────────────────────────────────────────────────────────

/**
 * Returns the absolute path to the flake history JSON file.
 * Priority: RAPITAS_TEST_FLAKE_HISTORY_PATH → RAPITAS_DATA_DIR → backendRoot.
 *
 * @param backendRoot - Absolute path to the backend root / バックエンドルートの絶対パス
 * @returns Absolute path to the history file / 履歴ファイルの絶対パス
 */
export function getFlakeHistoryPath(backendRoot: string): string {
  const explicit = process.env.RAPITAS_TEST_FLAKE_HISTORY_PATH;
  if (explicit) return explicit;
  const filename = '.rapitas-flake-history.json';
  const dataDir = process.env.RAPITAS_DATA_DIR;
  if (dataDir) return join(dataDir, filename);
  return join(backendRoot, filename);
}

/**
 * Reads the flake history JSON file, returning an empty history on missing or parse failure.
 * Never throws; errors are surfaced as console.warn.
 *
 * @param backendRoot - Absolute path to the backend root / バックエンドルートの絶対パス
 * @returns Parsed history, or empty history on any read error / 履歴またはエラー時は空履歴
 */
export function loadFlakeHistoryOrEmpty(backendRoot: string): FlakeHistoryFile {
  const empty: FlakeHistoryFile = { version: 1, updatedAt: '', entries: {} };
  const path = getFlakeHistoryPath(backendRoot);
  try {
    if (!existsSync(path)) return empty;
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as FlakeHistoryFile;
  } catch (err) {
    console.warn(`[retry-policy] Failed to load flake history from ${path}: ${String(err)}`);
    return empty;
  }
}

/**
 * Writes the flake history to disk. Failures are logged but do not throw,
 * so a write error never affects the test run's exit code.
 *
 * @param history - History to persist / 書き込む履歴
 * @param backendRoot - Absolute path to the backend root / バックエンドルートの絶対パス
 */
export function saveFlakeHistory(history: FlakeHistoryFile, backendRoot: string): void {
  const path = getFlakeHistoryPath(backendRoot);
  try {
    writeFileSync(path, JSON.stringify(history, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[retry-policy] Failed to save flake history to ${path}: ${String(err)}`);
  }
}
