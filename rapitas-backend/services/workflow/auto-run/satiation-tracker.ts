/**
 * satiation-tracker
 *
 * File-backed per-theme counter of consecutive DRY auto-run cycles (all_done
 * with zero backlog promotion). Two consecutive dry cycles mark the theme
 * "satiated" (飽和完了, 要求B.1). Persisted to RAPITAS_DATA_DIR so the count
 * survives the restartOnAutoRunDry dev restart (exit75) — an in-memory counter
 * would reset there and either re-send the satiated notification or never
 * reach 2. Not responsible for deciding WHEN a cycle is dry; the scheduler is.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

/** Consecutive dry cycles required to enter the satiated state (要求B.1). */
export const SATIATION_DRY_CYCLE_THRESHOLD = 2;

interface SatiationThemeState {
  dryCycles: number;
  satiated: boolean;
}

type SatiationState = Record<string, SatiationThemeState>;

function dataDir(): string {
  return process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas');
}

function stateFile(): string {
  return join(dataDir(), '.satiation-state.json');
}

/**
 * Under bun test WITHOUT an explicit RAPITAS_DATA_DIR scratch dir, never touch
 * the operator's real ~/.rapitas state (mirrors cycle-event-logger's isTest
 * guard — a test opts into the file path by setting RAPITAS_DATA_DIR).
 */
function isUnscopedTestRun(): boolean {
  return process.env.NODE_ENV === 'test' && !process.env.RAPITAS_DATA_DIR?.trim();
}

/** Read the persisted state; a missing or corrupt file resets to empty (fail-open). */
function readState(): SatiationState {
  if (isUnscopedTestRun()) return {};
  try {
    const raw = JSON.parse(readFileSync(stateFile(), 'utf8')) as unknown;
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const state: SatiationState = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value == null || typeof value !== 'object') continue;
      const entry = value as Partial<SatiationThemeState>;
      if (typeof entry.dryCycles !== 'number' || !Number.isFinite(entry.dryCycles)) continue;
      state[key] = { dryCycles: entry.dryCycles, satiated: entry.satiated === true };
    }
    return state;
  } catch {
    return {};
  }
}

/** Best-effort write; a failed write only weakens persistence, never crashes. */
function writeState(state: SatiationState): void {
  if (isUnscopedTestRun()) return;
  try {
    const file = stateFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state));
  } catch {
    // Never let a tracker write failure crash the scheduler tick.
  }
}

/**
 * Record one dry cycle for a theme and report whether the theme JUST crossed
 * into the satiated state (exactly once per satiation episode — later dry
 * cycles keep satiated=true but justSatiated=false, so the notification is
 * not re-sent).
 *
 * @param themeId - Theme whose cycle ran dry / ドライ周期のテーマID
 * @returns Updated count and the one-shot satiation edge / 更新後カウントと飽和遷移
 */
export function recordDryCycle(themeId: number): { dryCycles: number; justSatiated: boolean } {
  const state = readState();
  const key = String(themeId);
  const current = state[key] ?? { dryCycles: 0, satiated: false };
  const dryCycles = current.dryCycles + 1;
  const satiated = dryCycles >= SATIATION_DRY_CYCLE_THRESHOLD;
  const justSatiated = satiated && !current.satiated;
  state[key] = { dryCycles, satiated };
  writeState(state);
  return { dryCycles, justSatiated };
}

/**
 * Reset a theme's satiation state (called when the dry chain breaks: a task
 * was selected, a promotion created tasks, or an unmerged repair PR exists).
 * No-ops without touching the file when the theme is already reset.
 *
 * @param themeId - Theme to reset / リセットするテーマID
 */
export function resetSatiation(themeId: number): void {
  const state = readState();
  const key = String(themeId);
  if (!(key in state)) return; // already reset — skip the fs write
  delete state[key];
  writeState(state);
}

/**
 * Whether a theme is currently in the satiated state.
 *
 * @param themeId - Theme to check / 対象テーマID
 * @returns true when satiated / 飽和状態なら true
 */
export function isSatiated(themeId: number): boolean {
  return readState()[String(themeId)]?.satiated === true;
}
