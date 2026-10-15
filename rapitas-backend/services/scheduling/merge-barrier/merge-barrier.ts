/**
 * MergeBarrier
 *
 * File-backed persistence for the mergeBarrierEnabled toggle (default OFF) and
 * the pure hold decision used by the theme auto-run scheduler: when the barrier
 * is ON, the scheduler must not start the next task while the theme still has
 * an OPEN auto-created PR — until either the PR leaves the open set (merged /
 * closed) or the hold exceeds a timeout (deadlock release for a PR stuck open
 * on red CI / manual review).
 * Lives in RAPITAS_DATA_DIR (default ~/.rapitas) because UserSettings gains no
 * new Prisma column for this feature (schema changes are prohibited) — same
 * mechanism as auto-restart-merged-code/settings-store.ts.
 * Not responsible for querying PRs or scheduling — see theme-auto-run-scheduler.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

/** Resolve the data directory (same logic as the sibling settings stores). */
function dataDir(): string {
  return process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas');
}

function enabledFile(): string {
  return join(dataDir(), '.merge-barrier-enabled');
}

/** Default hold ceiling before the barrier times out and releases (30 min). */
export const MERGE_BARRIER_DEFAULT_MAX_HOLD_MS = 30 * 60 * 1000;

/**
 * Effective barrier hold ceiling in ms. Read at call time so tests and
 * operators can override without a restart.
 *
 * @returns MERGE_BARRIER_MAX_HOLD_MS env override, or the 30-min default / 保留上限ms
 */
export function getMergeBarrierMaxHoldMs(): number {
  const raw = Number.parseInt(process.env.MERGE_BARRIER_MAX_HOLD_MS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : MERGE_BARRIER_DEFAULT_MAX_HOLD_MS;
}

/** Best-effort write; a failed write only weakens the toggle, never crashes. */
function writeBestEffort(file: string, content: string): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  } catch {
    // Never let a settings write failure crash a request or the scheduler.
  }
}

/**
 * Read the mergeBarrierEnabled toggle.
 *
 * @returns True only when the file contains "true"; absent/invalid = false (default OFF) / トグル値（不在時false）
 */
export function readMergeBarrierEnabled(): boolean {
  try {
    return readFileSync(enabledFile(), 'utf8').trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Persist the mergeBarrierEnabled toggle.
 *
 * @param value - New toggle state / 新しいトグル状態
 */
export function writeMergeBarrierEnabled(value: boolean): void {
  writeBestEffort(enabledFile(), value ? 'true' : 'false');
}

/**
 * Pure barrier decision: whether the scheduler should HOLD next-task selection.
 * Holds only while (a) the barrier is enabled, (b) the theme still has an open
 * auto-PR, and (c) the hold has not yet exceeded `maxHoldMs` — the timeout
 * release prevents a PR stuck open (red CI, exhausted retries, manual review)
 * from deadlocking the whole theme.
 *
 * @param enabled - mergeBarrierEnabled toggle state / バリア設定値
 * @param openPrExists - Theme has at least one open auto-created PR / テーマ内オープン自動PRの有無
 * @param holdSinceMs - Epoch ms when this hold began (null = hold starting now) / 保留開始時刻
 * @param nowMs - Current epoch ms / 現在時刻
 * @param maxHoldMs - Hold ceiling before timeout release / 保留上限ms
 * @returns True when selection must be held this tick / 保留すべきならtrue
 */
export function shouldHoldForBarrier(
  enabled: boolean,
  openPrExists: boolean,
  holdSinceMs: number | null,
  nowMs: number,
  maxHoldMs: number,
): boolean {
  if (!enabled || !openPrExists) return false;
  if (holdSinceMs === null) return true; // hold starting this tick
  return nowMs - holdSinceMs < maxHoldMs;
}
