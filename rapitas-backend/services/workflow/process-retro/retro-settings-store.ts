/**
 * RetroSettingsStore
 *
 * File-backed persistence for the retroReviewEnabled toggle (default ON).
 * Lives in RAPITAS_DATA_DIR (default ~/.rapitas) because UserSettings gains no
 * new Prisma column for this feature (schema changes are prohibited) — same
 * mechanism as auto-restart-merged-code/settings-store.ts, but with the
 * absent-file default INVERTED to true (the retrospective is opt-out).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

function dataDir(): string {
  return process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas');
}

function enabledFile(): string {
  return join(dataDir(), '.retro-review-enabled');
}

/** Best-effort write; a failed write only weakens the toggle, never crashes. */
function writeBestEffort(file: string, content: string): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  } catch {
    // Never let a settings write failure crash a request or the retro path.
  }
}

/**
 * Read the retroReviewEnabled toggle.
 *
 * @returns False only when the file explicitly contains "false"; absent or
 *   invalid = true (default ON) / トグル値（不在時true=既定ON）
 */
export function readRetroReviewEnabled(): boolean {
  try {
    return readFileSync(enabledFile(), 'utf8').trim() !== 'false';
  } catch {
    return true;
  }
}

/**
 * Persist the retroReviewEnabled toggle.
 *
 * @param value - New toggle state / 新しいトグル状態
 */
export function writeRetroReviewEnabled(value: boolean): void {
  writeBestEffort(enabledFile(), value ? 'true' : 'false');
}
