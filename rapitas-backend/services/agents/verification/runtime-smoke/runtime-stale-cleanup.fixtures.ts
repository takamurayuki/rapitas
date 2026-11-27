/**
 * runtime-stale-cleanup.fixtures
 *
 * Simulated process table, listeners and launch history for the stale-cleanup
 * tests. Split out of runtime-stale-cleanup.test.ts (752 lines) so the tests
 * can be split by concern.
 */
import type { StaleCleanupDeps } from './runtime-stale-cleanup';
import { normalizeForMatch, tokenizeCommandLine } from './runtime-command-match';
import type { LaunchRecord } from './runtime-launch-history';
import type { RuntimeProcessIdentity } from './runtime-process-identity';
import type { RuntimeProcessSnapshot } from './runtime-process-snapshot';

export const WORKDIR = 'C:/w/task-15';
export const LOCK_PATH = `${WORKDIR}/.next/dev/lock`;
export const proc = (pid: number, command: string, parentPid = 1): RuntimeProcessIdentity => ({
  pid,
  parentPid,
  birth: String(1000 + pid),
  command,
});
/** A history record exactly as the launch would have written it for `row`. */
export const rec = (
  row: RuntimeProcessIdentity,
  role: 'root' | 'observed' = 'root',
): LaunchRecord => ({
  key: `process:${row.pid}:${row.birth}`,
  kind: 'process',
  workdir: normalizeForMatch(WORKDIR),
  pid: row.pid,
  birth: row.birth,
  role,
  command: row.command,
  argv: tokenizeCommandLine(row.command),
  recordedAt: '2026-11-25T00:00:00.000Z',
});
export const lockRec = (pid: number, birth: string): LaunchRecord => ({
  key: `lock:${LOCK_PATH}`,
  kind: 'lock',
  workdir: normalizeForMatch(WORKDIR),
  pid,
  birth,
  role: 'lock',
  command: '',
  argv: null,
  lockPath: LOCK_PATH,
  recordedAt: '2026-11-25T00:00:00.000Z',
});
export const SERVER = proc(40, `"${WORKDIR}/server.exe" --serve`);
export const CFG = { url: 'http://127.0.0.1:8090', start: 'server' };
export const NO_PORT = { url: 'http://127.0.0.1:{port}', start: 'server {port}' };

export interface WorldOptions {
  history?: LaunchRecord[];
  protectedPids?: number[];
  /** Pid named by a live runtime lock; `unknown` = a lock the directory check cannot attribute. */
  lock?: { pid?: number; unknown?: boolean };
  /** PID the lock FILE currently names (for stale removal). */
  lockFilePid?: number | null;
  unkillable?: boolean;
  excludePids?: number[];
}

/** Simulated OS: a mutable process table where stopping removes the process. */
export function world(
  initial: RuntimeProcessIdentity[],
  listeners: Array<{ port: number; pid: number }>,
  opts: WorldOptions = {},
) {
  let rows = [...initial];
  const history = [...(opts.history ?? [])];
  let time = 0;
  const killed: number[] = [];
  const removed: string[] = [];
  const view = (): RuntimeProcessSnapshot => ({
    processes: rows,
    protectedPids: new Set(opts.protectedPids ?? []),
    listeners: listeners.filter((l) => rows.some((r) => r.pid === l.pid)),
  });
  const deps: StaleCleanupDeps = {
    snapshot: async () => view(),
    inspectDirectory: async (_dir, processes) => {
      if (opts.lock?.unknown) return { free: false, reason: 'Unknown runtime lock owner' };
      const holder = opts.lockFilePid ?? opts.lock?.pid;
      if (holder !== undefined && holder !== null && !removed.includes(LOCK_PATH)) {
        return {
          free: !processes.some((p) => p.pid === holder),
          reason: `occupied by PID ${holder}`,
          pid: holder,
          path: LOCK_PATH,
        };
      }
      return { free: true };
    },
    readHistory: async () => [...history],
    recordProcesses: async (_dir, identities, role) => {
      history.push(...identities.map((row) => rec(row, role)));
      return true;
    },
    readLockPid: async () =>
      removed.includes(LOCK_PATH) ? null : (opts.lockFilePid ?? opts.lock?.pid ?? null),
    removeLock: async (path, expected) => {
      if ((opts.lockFilePid ?? opts.lock?.pid) !== expected) return false;
      removed.push(path);
      return true;
    },
    excludePids: new Set(opts.excludePids ?? []),
    stopTimeoutMs: 50,
    stopDeps: {
      snapshot: async () => view(),
      terminate: async (p) => {
        killed.push(p.pid);
        if (!opts.unkillable) rows = rows.filter((r) => r.pid !== p.pid);
      },
      wait: async () => {
        time += 10;
      },
      now: () => time,
    },
  };
  return { deps, killed, removed };
}
