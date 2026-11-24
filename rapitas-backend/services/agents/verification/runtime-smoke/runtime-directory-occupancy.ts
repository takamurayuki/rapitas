import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { RuntimeProcessIdentity } from './runtime-process-identity';

/**
 * Inspect Next's server-info files in the supported Rapitas layouts. Never
 * delete a lock or signal its PID: these files establish occupancy, not
 * ownership. An unlocked file may remain after process exit on POSIX.
 */
export async function inspectRuntimeDirectory(
  workdir: string,
  processes: RuntimeProcessIdentity[],
): Promise<{ free: boolean; reason?: string; pid?: number; path?: string }> {
  for (const project of ['', 'rapitas-frontend']) {
    for (const output of ['.next', '.next-tauri']) {
      for (const variant of ['', 'dev']) {
        const path = join(workdir, project, output, variant, 'lock');
        let content: string;
        try {
          content = await readFile(path, 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          return { free: false, reason: `Cannot inspect runtime lock: ${path}` };
        }
        try {
          const info = JSON.parse(content);
          if (!Number.isInteger(info?.pid) || info.pid <= 0) {
            return { free: false, reason: `Unknown runtime lock owner: ${path}` };
          }
          if (processes.some((process) => process.pid === info.pid)) {
            return {
              free: false,
              reason: `Runtime directory occupied by PID ${info.pid}: ${path}`,
              pid: info.pid,
              path,
            };
          }
        } catch {
          return { free: false, reason: `Unreadable runtime lock metadata: ${path}` };
        }
      }
    }
  }
  return { free: true };
}

/**
 * Read the PID a runtime lock file names, or null when the file is absent or
 * unreadable.
 *
 * @param path - Lock file path / ロックファイルのパス
 * @returns PID in the lock, or null / ロックのPID
 */
export async function readRuntimeLockPid(path: string): Promise<number | null> {
  try {
    const pid = JSON.parse(await readFile(path, 'utf8'))?.pid;
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Delete a lock file only if it still names the expected PID (re-read right
 * before unlinking, so a lock rewritten by a new owner is never removed).
 *
 * @param path - Lock file path / ロックファイルのパス
 * @param expectedPid - PID recorded at launch / 起動時に記録したPID
 * @returns True when the file was removed / 削除したらtrue
 */
export async function removeRuntimeLockIfOwnedBy(
  path: string,
  expectedPid: number,
): Promise<boolean> {
  if ((await readRuntimeLockPid(path)) !== expectedPid) return false;
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}
