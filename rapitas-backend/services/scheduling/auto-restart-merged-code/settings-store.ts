/**
 * AutoRestartMergedCodeSettingsStore
 *
 * File-backed persistence for the autoRestartOnMergedCode toggle and the
 * last-restart rate-limit stamps. Lives in RAPITAS_DATA_DIR (default
 * ~/.rapitas) because UserSettings gains no new Prisma column for this
 * feature (schema changes are prohibited).
 * NOTE: Writes stay separate (dev-restart-on-dry writes .dev-restart-last-at,
 * the merged-code paths and deploy-now write .auto-restart-merged-code-last-at)
 * but reads are combined via readLatestAutoRestartAt, so the three automatic
 * restart paths share one floor that survives the relaunch it throttles
 * (task 1548: ten restarts on 2026-11-25 slipped between independent floors).
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

function devRestartFile(): string {
  return join(dataDir(), '.dev-restart-last-at');
}

function deferCountFile(): string {
  return join(dataDir(), '.auto-restart-merged-code-defer-count');
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

/** Read an epoch-ms stamp file; absent/invalid = 0. */
function readStamp(file: string): number {
  try {
    const ts = Number.parseInt(readFileSync(file, 'utf8').trim(), 10);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

/**
 * Read the last merged-code / deploy-now restart timestamp.
 *
 * @returns Epoch ms of the last auto-restart, or 0 when absent/invalid / 前回再起動時刻（不在時0）
 */
export function readLastRestartAt(): number {
  return readStamp(lastRestartFile());
}

/**
 * Read the last dev-restart-on-dry restart timestamp.
 *
 * @returns Epoch ms, or 0 when absent/invalid / 前回の枯渇時再起動の時刻（不在時0）
 */
export function readDevRestartLastAt(): number {
  return readStamp(devRestartFile());
}

/**
 * Persist the last dev-restart-on-dry restart timestamp.
 *
 * @param ts - Epoch ms of the restart being fired / 発火する再起動の時刻
 */
export function writeDevRestartLastAt(ts: number): void {
  writeBestEffort(devRestartFile(), String(ts));
}

/**
 * The most recent restart across every automatic path, for the shared floor.
 *
 * @returns Larger of the two stamps, or 0 when neither exists / 2つの記録の新しい方（無ければ0）
 */
export function readLatestAutoRestartAt(): number {
  return Math.max(readLastRestartAt(), readDevRestartLastAt());
}

/**
 * Persist the last auto-restart timestamp.
 *
 * @param ts - Epoch ms of the restart being fired / 発火する再起動の時刻
 */
export function writeLastRestartAt(ts: number): void {
  writeBestEffort(lastRestartFile(), String(ts));
}

/**
 * Read the boundary-restart UI-activity deferral count. File-backed so the
 * deferral ceiling survives the very relaunch it throttles.
 *
 * @returns Non-negative deferral count, or 0 when absent/invalid / 先送りカウント（不在・不正時0）
 */
export function readDeferCount(): number {
  try {
    const n = Number.parseInt(readFileSync(deferCountFile(), 'utf8').trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Persist the boundary-restart UI-activity deferral count.
 *
 * @param count - New deferral count (clamped to a non-negative integer) / 新しい先送りカウント
 */
export function writeDeferCount(count: number): void {
  writeBestEffort(deferCountFile(), String(Math.max(0, Math.trunc(count))));
}
