/**
 * value-gate-settings-store
 *
 * File-backed persistence for the valueGateEnabled toggle (default ON) that
 * governs both the concern value gate and the satiation completion trigger.
 * Lives in RAPITAS_DATA_DIR (default ~/.rapitas) because Prisma schema changes
 * are prohibited for this feature — same mechanism and absent-file default as
 * process-retro/retro-settings-store.ts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

function dataDir(): string {
  return process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas');
}

function enabledFile(): string {
  return join(dataDir(), '.value-gate-enabled');
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
 * Read the valueGateEnabled toggle.
 *
 * @returns False only when the file explicitly contains "false"; absent or
 *   invalid = true (default ON) / トグル値（不在時true=既定ON）
 */
export function readValueGateEnabled(): boolean {
  try {
    return readFileSync(enabledFile(), 'utf8').trim() !== 'false';
  } catch {
    return true;
  }
}

/**
 * Persist the valueGateEnabled toggle.
 *
 * @param value - New toggle state / 新しいトグル状態
 */
export function writeValueGateEnabled(value: boolean): void {
  writeBestEffort(enabledFile(), value ? 'true' : 'false');
}
