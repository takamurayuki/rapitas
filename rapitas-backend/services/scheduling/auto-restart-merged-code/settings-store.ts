/**
 * AutoRestartMergedCodeSettingsStore
 *
 * File-backed persistence for the autoRestartOnMergedCode toggle and the
 * last-restart rate-limit stamp. Lives in RAPITAS_DATA_DIR (default
 * ~/.rapitas) because UserSettings gains no new Prisma column for this
 * feature (schema changes are prohibited) — same mechanism as the
 * .dev-restart-last-at stamp, but deliberately separate files so the two
 * restart mechanisms keep independent rate limits.
 * Not responsible for gate evaluation — see decision.ts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

/** Resolve the data directory (same logic as dev-restart-on-dry's stamp file). */
function dataDir(): string {
  return process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas');
}

function enabledFile(): string {
  return join(dataDir(), '.auto-restart-merged-code-enabled');
}

function lastRestartFile(): string {
  return join(dataDir(), '.auto-restart-merged-code-last-at');
}

/** Best-effort write; a failed write only weakens the toggle/rate limit, never crashes. */
function writeBestEffort(file: string, content: string): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  } catch {
    // Never let a settings write failure crash a request or the restart path.
  }
}

/**
 * Read the autoRestartOnMergedCode toggle.
 *
 * @returns True only when the file contains "true"; absent/invalid = false (safe default) / トグル値（不在時false）
 */
export function readAutoRestartEnabled(): boolean {
  try {
    return readFileSync(enabledFile(), 'utf8').trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Persist the autoRestartOnMergedCode toggle.
 *
 * @param value - New toggle state / 新しいトグル状態
 */
export function writeAutoRestartEnabled(value: boolean): void {
  writeBestEffort(enabledFile(), value ? 'true' : 'false');
}

/**
 * Read the last auto-restart timestamp for rate limiting.
 *
 * @returns Epoch ms of the last auto-restart, or 0 when absent/invalid / 前回再起動時刻（不在時0）
 */
export function readLastRestartAt(): number {
  try {
    const ts = Number.parseInt(readFileSync(lastRestartFile(), 'utf8').trim(), 10);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

/**
 * Persist the last auto-restart timestamp.
 *
 * @param ts - Epoch ms of the restart being fired / 発火する再起動の時刻
 */
export function writeLastRestartAt(ts: number): void {
  writeBestEffort(lastRestartFile(), String(ts));
}
