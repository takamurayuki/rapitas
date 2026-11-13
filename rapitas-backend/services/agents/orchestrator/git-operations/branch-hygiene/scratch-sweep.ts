/**
 * ScratchSweep
 *
 * Removes the workflow scratch files agents leave next to the repository —
 * curl payloads like `.wf-1103-plan.json`, prompt transports `.wf-<uuid>.md`,
 * `.wftmp.json`, `.tmp_wf*`, and the `Projectsrapitas.worktrees…wf-check.json`
 * a mis-joined Windows path produces. They are git-ignored, so nothing ever
 * noticed them piling up (36 found on 2026-11-14, the oldest from September).
 *
 * Only files at the repository root and the package roots, only names of
 * that shape, only when older than `maxAgeMs` (an agent may be mid-request),
 * and only when `git check-ignore` confirms git ignores them — a tracked or
 * deliberately un-ignored file of the same shape is never touched.
 */
import { execFile } from 'node:child_process';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createLogger } from '../../../../../config/logger';

const execFileAsync = promisify(execFile);
const logger = createLogger('git-operations/scratch-sweep');

/** Old enough that no request is still using it. */
export const DEFAULT_SCRATCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Where agents write these: next to each package's own scripts. */
export const DEFAULT_PACKAGE_DIRS = [
  'rapitas-backend',
  'rapitas-frontend',
  'rapitas-desktop',
  'rapitas-mobile',
];
const SCRATCH_NAME = /^\.wf-|\.wf-|^\.wftmp|^\.tmp_wf/;

/** What one sweep removed. */
export interface ScratchSweepResult {
  /** Removed files, relative to the repository root. */
  removed: string[];
}

async function ignoredByGit(baseDir: string, rel: string): Promise<boolean> {
  try {
    // Exit 0 = ignored; 1 = not ignored; anything else = unknown → keep.
    await execFileAsync('git', ['check-ignore', '-q', '--no-index', rel], {
      cwd: baseDir,
      windowsHide: true,
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove old, git-ignored workflow scratch files.
 *
 * @param baseDir - Repository root / リポジトリのルート
 * @param options.now - Current time in ms / 現在時刻
 * @param options.maxAgeMs - Minimum age to remove / 削除する最小経過時間
 * @param options.packageDirs - Package roots to look in besides the root / ルート以外に見るパッケージ
 * @returns The removed files / 削除したファイル
 */
export async function sweepScratchFiles(
  baseDir: string,
  options: { now?: number; maxAgeMs?: number; packageDirs?: string[] } = {},
): Promise<ScratchSweepResult> {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_SCRATCH_MAX_AGE_MS;
  const dirs = ['', ...(options.packageDirs ?? DEFAULT_PACKAGE_DIRS)];
  const removed: string[] = [];

  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(join(baseDir, dir));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!SCRATCH_NAME.test(name)) continue;
      const rel = dir ? `${dir}/${name}` : name;
      const abs = join(baseDir, rel);
      try {
        const st = statSync(abs);
        if (!st.isFile() || now - st.mtimeMs < maxAgeMs) continue;
      } catch {
        continue;
      }
      if (!(await ignoredByGit(baseDir, rel))) continue;
      try {
        rmSync(abs);
        removed.push(rel);
      } catch {
        /* in use or already gone: next cycle */
      }
    }
  }

  if (removed.length > 0) {
    logger.info({ removed }, `[sweepScratchFiles] Removed ${removed.length} scratch file(s)`);
  }
  return { removed };
}
