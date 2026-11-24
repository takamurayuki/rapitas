import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { RuntimeProcessIdentity } from './runtime-process-identity';

export interface RuntimeLockOccupancy {
  path: string;
  pid?: number;
  reason?: string;
}
export interface RuntimeDirectoryOccupancy {
  free: boolean;
  reason?: string;
  pid?: number;
  path?: string;
  /** 死亡した持ち主のロックも、履歴照合のために残す。 */
  locks?: RuntimeLockOccupancy[];
}

/**
 * Inspect Next's server-info files in the supported Rapitas layouts. Never
 * delete a lock or signal its PID: these files establish occupancy, not
 * ownership. An unlocked file may remain after process exit on POSIX.
 */
export async function inspectRuntimeDirectory(
  workdir: string,
  processes: RuntimeProcessIdentity[],
  historyPaths: readonly string[] = [],
): Promise<RuntimeDirectoryOccupancy> {
  const locks: RuntimeLockOccupancy[] = [];
  let blocked: RuntimeLockOccupancy | undefined;
  const paths = new Set(historyPaths);
  for (const project of ['', 'rapitas-frontend']) {
    for (const output of ['.next', '.next-tauri']) {
      for (const variant of ['', 'dev']) {
        paths.add(join(workdir, project, output, variant, 'lock'));
      }
    }
  }
  for (const path of paths) {
    let content: string;
    try {
      content = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      const lock = { path, reason: `Cannot inspect runtime lock: ${path}` };
      locks.push(lock);
      blocked ??= lock;
      continue;
    }
    try {
      const info = JSON.parse(content);
      if (!Number.isInteger(info?.pid) || info.pid <= 0) {
        const lock = { path, reason: `Unknown runtime lock owner: ${path}` };
        locks.push(lock);
        blocked ??= lock;
        continue;
      }
      const lock = { path, pid: info.pid as number };
      locks.push(lock);
      if (processes.some((process) => process.pid === info.pid)) {
        blocked ??= {
          reason: `Runtime directory occupied by PID ${info.pid}: ${path}`,
          ...lock,
        };
      }
    } catch {
      const lock = { path, reason: `Unreadable runtime lock metadata: ${path}` };
      locks.push(lock);
      blocked ??= lock;
    }
  }
  return locks.length ? { free: !blocked, ...(blocked ?? locks[0]), locks } : { free: true };
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
