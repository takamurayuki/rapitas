/**
 * ci-timing
 *
 * Core analytics for CI test timing: serial-gate list, cache path resolution,
 * cache read helpers, and pure analytics computation (stats, slowest, candidates).
 * Used by both the timing CLI (scripts/test-timing.ts) and the GET /ci-timing API route.
 * Does NOT depend on Prisma — all state lives in a local JSON cache file.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// NOTE: Inline parse equivalent to scripts/gate-manifest-parser.ts:parseGateManifest.
// Inlined to avoid a services/ → scripts/ layer-crossing import.
function parseManifestLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * Fallback gate list used when scripts/ci-gate-tests.txt cannot be read.
 * NOTE: Corrected from the stale hard-coded list; task-dependency-service → task-resolver.
 */
const SERIAL_GATE_FALLBACK: readonly string[] = [
  'tests/debug-log-analyzer.test.ts',
  'tests/debug-log-parsers.test.ts',
  'tests/event-emitter.test.ts',
  'tests/metrics-collector.test.ts',
  'tests/registry.test.ts',
  'services/ai/weekly-review-service.test.ts',
  'services/task/task-resolver.test.ts',
  'services/agents/verification/automated-verifier.test.ts',
  'tests/integration/claude-code-agent.integration.test.ts',
  'tests/middleware/error-handler.test.ts',
];

function loadSerialGateFiles(): readonly string[] {
  try {
    // NOTE: import.meta.dir = services/analytics/ — two levels up is backend root.
    const manifestPath = join(import.meta.dir, '..', '..', 'scripts', 'ci-gate-tests.txt');
    const text = readFileSync(manifestPath, 'utf-8');
    const parsed = parseManifestLines(text);
    return parsed.length > 0 ? parsed : SERIAL_GATE_FALLBACK;
  } catch {
    return SERIAL_GATE_FALLBACK;
  }
}

/**
 * Serial gate file list — loaded from scripts/ci-gate-tests.txt (SSOT).
 * Falls back to a corrected built-in list when the manifest cannot be read.
 * Drift is caught by the manifest drift guard in ci-timing.test.ts.
 */
export const SERIAL_GATE_FILES: readonly string[] = loadSerialGateFiles();

/** Single test file timing entry stored in the JSON cache. */
export interface TimingEntry {
  /** Path relative to the backend root directory. */
  file: string;
  /** Wall-clock elapsed time in milliseconds. */
  elapsedMs: number;
  /** Process exit code; 0 = pass. */
  exitCode: number;
}

/** Raw JSON structure written by scripts/test-timing.ts. */
export interface TimingCacheRaw {
  /** ISO timestamp of when the cache was generated. */
  generatedAt: string;
  /** Total wall-clock time for the entire parallel run in ms. */
  wallClockMs: number;
  /** Per-file timing results. */
  results: TimingEntry[];
}

/** Return value of readTimingCacheOrEmpty. */
export interface TimingCacheResult {
  /** True when a valid cache file was found and parsed successfully. */
  available: boolean;
  /** ISO timestamp of cache generation (only when available=true). */
  generatedAt?: string;
  /** Total parallel wall-clock time in ms (only when available=true). */
  wallClockMs?: number;
  /** Per-file results; empty when available=false. */
  results: TimingEntry[];
  /** Human-readable error note when available=false due to a read/parse error. */
  note?: string;
}

/** Aggregated timing statistics for a set of results. */
export interface TimingStats {
  /** Arithmetic mean in ms. */
  mean: number;
  /** 50th-percentile (median) in ms. */
  p50: number;
  /** 90th-percentile in ms. */
  p90: number;
  /** Maximum elapsed ms across all entries. */
  max: number;
  /** Number of entries included in the computation. */
  count: number;
}

/** Timing entry with derived analytics fields. */
export interface TimingEntryAnalyzed extends TimingEntry {
  /** Whether this file appears in the serial gate list. */
  inGate: boolean;
  /** Whether the test process exited with a non-zero code. */
  failed: boolean;
}

/** Full analytics payload returned by computeCiTimingAnalytics. */
export interface CiTimingAnalytics {
  /** True when cache data is available and valid. */
  available: boolean;
  /** Error note when available=false. */
  note?: string;
  /** ISO timestamp from the cache (when available=true). */
  generatedAt?: string;
  /** Total parallel wall-clock time from the cache run in ms. */
  wallClockMs?: number;
  /** Total number of measured test files. */
  totalFiles: number;
  /** Aggregate timing statistics across all files. */
  stats: TimingStats;
  /** Serial-gate entries from the measured results (in gate order). */
  serialGate: TimingEntryAnalyzed[];
  /** Top N slowest files, descending by elapsedMs. */
  slowest: TimingEntryAnalyzed[];
  /** Fast files (elapsedMs ≤ threshold) not in the serial gate — promotion candidates. */
  promotionCandidates: TimingEntryAnalyzed[];
  /** Slow files (elapsedMs ≥ threshold) in the serial gate — demotion candidates. */
  demotionCandidates: TimingEntryAnalyzed[];
  /** Elapsed-time threshold used for promotion/demotion classification in ms. */
  promoteThresholdMs: number;
  /** Serial-gate file paths absent from measured results (renamed or deleted). */
  missingFromResults: string[];
}

/** Options for computeCiTimingAnalytics. */
export interface AnalyticsOptions {
  /**
   * Files ≤ this value (ms) are promotion candidates; files ≥ this value are demotion candidates.
   * Falls back to RAPITAS_TIMING_PROMOTE_MAX_MS env var, then 2000.
   */
  promoteMaxMs?: number;
  /** Number of slowest-file entries to include. Default: 15. */
  slowestN?: number;
}

/**
 * Returns the absolute path to the timing JSON cache file.
 * Uses RAPITAS_DATA_DIR when available; falls back to the backend root.
 *
 * @returns Absolute path to .rapitas-test-timing.json / キャッシュファイルの絶対パス
 */
export function getTimingCachePath(): string {
  const dataDir = process.env.RAPITAS_DATA_DIR;
  const filename = '.rapitas-test-timing.json';
  if (dataDir) return join(dataDir, filename);
  // NOTE: import.meta.dir = services/analytics/ — two levels up is the backend root.
  return join(import.meta.dir, '..', '..', filename);
}

/**
 * Reads the timing JSON cache, returning an empty result on missing file or parse failure.
 * Never throws; errors are surfaced as available=false with a descriptive note.
 *
 * @returns Cache data with available=true, or {available:false, results:[]} on error
 */
export function readTimingCacheOrEmpty(): TimingCacheResult {
  const cachePath = getTimingCachePath();
  try {
    if (!existsSync(cachePath)) {
      return { available: false, results: [] };
    }
    const raw = readFileSync(cachePath, 'utf-8');
    const data = JSON.parse(raw) as TimingCacheRaw;
    return { available: true, ...data };
  } catch (err) {
    return {
      available: false,
      results: [],
      note: `キャッシュ読み込みエラー: ${String(err)}`,
    };
  }
}

/**
 * Computes analytics from a timing cache result and serial gate list.
 * Pure function: no I/O, deterministic given the same inputs.
 *
 * @param cache - Result of readTimingCacheOrEmpty / タイミングキャッシュ
 * @param gate - Serial gate file list (relative paths) / シリアルゲートファイルリスト
 * @param opts - Analytics tuning options / 解析オプション
 * @returns Full analytics payload / 解析結果
 */
export function computeCiTimingAnalytics(
  cache: TimingCacheResult,
  gate: readonly string[],
  opts: AnalyticsOptions = {},
): CiTimingAnalytics {
  const envMs = process.env.RAPITAS_TIMING_PROMOTE_MAX_MS
    ? parseInt(process.env.RAPITAS_TIMING_PROMOTE_MAX_MS, 10)
    : undefined;
  const promoteThresholdMs =
    opts.promoteMaxMs ?? (envMs !== undefined && Number.isFinite(envMs) ? envMs : 2000);
  const slowestN = opts.slowestN ?? 15;

  const emptyStats: TimingStats = { mean: 0, p50: 0, p90: 0, max: 0, count: 0 };

  if (!cache.available || cache.results.length === 0) {
    return {
      available: cache.available,
      note: cache.note,
      totalFiles: 0,
      stats: emptyStats,
      serialGate: [],
      slowest: [],
      promotionCandidates: [],
      demotionCandidates: [],
      promoteThresholdMs,
      missingFromResults: [...gate],
    };
  }

  const results = cache.results;
  const gateSet = new Set(gate);
  const resultMap = new Map(results.map((r) => [r.file, r]));

  const enriched: TimingEntryAnalyzed[] = results.map((r) => ({
    ...r,
    inGate: gateSet.has(r.file),
    failed: r.exitCode !== 0,
  }));

  // Stats over all measured files (including failed).
  const sortedMs = enriched.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const count = sortedMs.length;
  const mean = count > 0 ? sortedMs.reduce((s, v) => s + v, 0) / count : 0;
  // NOTE: Using floor((n-1)*pct) to compute percentile index avoids out-of-bounds on single element.
  const p50 = count > 0 ? (sortedMs[Math.floor((count - 1) * 0.5)] ?? 0) : 0;
  const p90 = count > 0 ? (sortedMs[Math.floor((count - 1) * 0.9)] ?? 0) : 0;
  const max = count > 0 ? (sortedMs[count - 1] ?? 0) : 0;

  const sortedBySlowest = [...enriched].sort((a, b) => b.elapsedMs - a.elapsedMs);
  const slowest = sortedBySlowest.slice(0, slowestN);

  const promotionCandidates = enriched.filter(
    (r) => !r.inGate && r.elapsedMs <= promoteThresholdMs,
  );

  const demotionCandidates = enriched.filter((r) => r.inGate && r.elapsedMs >= promoteThresholdMs);

  const serialGate = gate
    .map((gf) => resultMap.get(gf))
    .filter((r): r is TimingEntry => r !== undefined)
    .map((r) => ({ ...r, inGate: true as const, failed: r.exitCode !== 0 }));

  const missingFromResults = gate.filter((gf) => !resultMap.has(gf));

  return {
    available: true,
    generatedAt: cache.generatedAt,
    wallClockMs: cache.wallClockMs,
    totalFiles: count,
    stats: { mean, p50, p90, max, count },
    serialGate,
    slowest,
    promotionCandidates,
    demotionCandidates,
    promoteThresholdMs,
    missingFromResults,
  };
}
