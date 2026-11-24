/**
 * runtime-stale-cleanup.test
 *
 * Injected process lists and listener tables prove that only leftovers of THIS
 * worktree's runtime launch are stopped, and that everything else (port 3001,
 * siblings, unidentifiable processes) is left alone and reported as an
 * environment cause.
 */
import { describe, expect, test } from 'bun:test';
import {
  cleanupStaleRuntime,
  commandReferencesWorkdir,
  fixedPortOf,
  classifyLaunchLogCause,
  type StaleCleanupDeps,
} from './runtime-stale-cleanup';
import type { RuntimeProcessIdentity } from './runtime-process-identity';
import type { RuntimeProcessSnapshot } from './runtime-process-snapshot';

const WORKDIR = process.platform === 'win32' ? 'C:\\w\\task-15' : '/w/task-15';
const SIBLING = process.platform === 'win32' ? 'C:\\w\\task-153' : '/w/task-153';
const proc = (pid: number, command: string, parentPid = 1): RuntimeProcessIdentity => ({
  pid,
  parentPid,
  birth: String(1000 + pid),
  command,
});
const CFG = { url: 'http://127.0.0.1:8090' };

/** Simulated OS: a mutable process table where stopping removes the process. */
function world(
  initial: RuntimeProcessIdentity[],
  listeners: Array<{ port: number; pid: number }>,
  opts: {
    protectedPids?: number[];
    lock?: { free: boolean; reason?: string; pid?: number };
    unkillable?: boolean;
  } = {},
) {
  let rows = [...initial];
  let time = 0;
  const killed: number[] = [];
  const view = (): RuntimeProcessSnapshot => ({
    processes: rows,
    protectedPids: new Set(opts.protectedPids ?? []),
    listeners: listeners.filter((l) => rows.some((r) => r.pid === l.pid)),
  });
  const deps: StaleCleanupDeps = {
    snapshot: async () => view(),
    inspectDirectory: async (_dir, processes) =>
      opts.lock &&
      !opts.lock.free &&
      opts.lock.pid &&
      !processes.some((p) => p.pid === opts.lock!.pid)
        ? { free: true }
        : (opts.lock ?? { free: true }),
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
  return { deps, killed };
}

describe('commandReferencesWorkdir', () => {
  test('matches on a path boundary only', () => {
    expect(commandReferencesWorkdir(`node ${WORKDIR}\\x\\server.js`, WORKDIR)).toBe(true);
    expect(commandReferencesWorkdir(`"${WORKDIR}/server.exe"`, WORKDIR)).toBe(true);
    expect(commandReferencesWorkdir(`node ${SIBLING}/server.js`, WORKDIR)).toBe(false);
    expect(commandReferencesWorkdir('', WORKDIR)).toBe(false);
  });
});

describe('fixedPortOf', () => {
  test('returns null for a placeholder or missing port, else the port', () => {
    expect(fixedPortOf('http://127.0.0.1:{port}')).toBeNull();
    expect(fixedPortOf('http://127.0.0.1')).toBeNull();
    expect(fixedPortOf('not a url')).toBeNull();
    expect(fixedPortOf('http://localhost:8090/x')).toBe(8090);
  });
});

describe('cleanupStaleRuntime', () => {
  test('stops a leftover listener of the same worktree and frees the port', async () => {
    const { deps, killed } = world([proc(40, `${WORKDIR}\\server.exe`)], [{ port: 8090, pid: 40 }]);
    const result = await cleanupStaleRuntime(WORKDIR, CFG, deps);
    expect(result).toEqual({ ok: true, stoppedPids: [40] });
    expect(killed).toEqual([40]);
  });

  test('never touches the port 3001 backend, even when its command names the worktree', async () => {
    const backend = proc(30, `bun ${WORKDIR}\\rapitas-backend\\index.ts`);
    const { deps, killed } = world([backend], [{ port: 3001, pid: 30 }], { protectedPids: [30] });
    const result = await cleanupStaleRuntime(WORKDIR, CFG, deps);
    expect(result).toEqual({ ok: true, stoppedPids: [] });
    expect(killed).toEqual([]);
  });

  test('a protected child under a matching leftover stops nothing and is foreign_process', async () => {
    const parent = proc(40, `${WORKDIR}\\server.exe`);
    const backend = proc(41, 'bun backend', 40); // younger than its parent, so part of its tree
    const { deps, killed } = world([parent, backend], [{ port: 8090, pid: 40 }], {
      protectedPids: [41],
    });
    const result = await cleanupStaleRuntime(WORKDIR, CFG, deps);
    expect(result).toMatchObject({ ok: false, cause: 'foreign_process' });
    expect(killed).toEqual([]);
  });

  test('a fixed-port holder whose identity is another worktree is not stopped', async () => {
    const other = proc(50, `node ${SIBLING}\\server.js`);
    const { deps, killed } = world([other], [{ port: 8090, pid: 50 }]);
    const result = await cleanupStaleRuntime(WORKDIR, CFG, deps);
    expect(result).toMatchObject({ ok: false, cause: 'foreign_process' });
    expect(killed).toEqual([]);
  });

  test('a fixed-port holder with an unreadable command line is not stopped', async () => {
    const { deps, killed } = world([proc(51, '')], [{ port: 8090, pid: 51 }]);
    const result = await cleanupStaleRuntime(WORKDIR, CFG, deps);
    expect(result).toMatchObject({ ok: false, cause: 'foreign_process' });
    expect(killed).toEqual([]);
  });

  test('does not stop its own process or an ancestor even if they name the worktree', async () => {
    const self = proc(process.pid, `bun test ${WORKDIR}`, 700);
    const ancestor = proc(700, `claude --cwd ${WORKDIR}`);
    const { deps, killed } = world(
      [self, ancestor],
      [
        { port: 8090, pid: process.pid },
        { port: 8091, pid: 700 },
      ],
    );
    const result = await cleanupStaleRuntime(WORKDIR, CFG, deps);
    expect(killed).toEqual([]);
    expect(result).toMatchObject({ ok: false, cause: 'foreign_process' });
  });

  test('an unkillable leftover is reported as port_in_use and nothing else is touched', async () => {
    const { deps } = world([proc(40, `${WORKDIR}\\server.exe`)], [{ port: 8090, pid: 40 }], {
      unkillable: true,
    });
    const result = await cleanupStaleRuntime(WORKDIR, CFG, deps);
    expect(result).toMatchObject({ ok: false, cause: 'port_in_use' });
  });

  test('a held runtime lock that survives cleanup is lock_held', async () => {
    const holder = proc(60, 'something unrelated');
    const { deps, killed } = world([holder], [], {
      lock: { free: false, reason: 'Runtime directory occupied by PID 60', pid: 60 },
    });
    const result = await cleanupStaleRuntime(WORKDIR, { url: 'http://127.0.0.1:{port}' }, deps);
    expect(result).toMatchObject({ ok: false, cause: 'lock_held' });
    expect(killed).toEqual([]);
  });

  test('a lock holder that names this worktree is stopped and the directory becomes free', async () => {
    const holder = proc(61, `node ${WORKDIR}\\node_modules\\next\\dist\\bin\\next dev`);
    const { deps, killed } = world([holder], [], {
      lock: { free: false, reason: 'occupied', pid: 61 },
    });
    const result = await cleanupStaleRuntime(WORKDIR, { url: 'http://127.0.0.1:{port}' }, deps);
    expect(result).toEqual({ ok: true, stoppedPids: [61] });
    expect(killed).toEqual([61]);
  });

  test('an empty world is a clean pass', async () => {
    const { deps } = world([], []);
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toEqual({ ok: true, stoppedPids: [] });
  });

  test('a snapshot without listener data cannot prove the port is free', async () => {
    const { deps } = world([], []);
    deps.snapshot = async () => ({ processes: [], protectedPids: new Set() });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'port_in_use',
    });
  });
});

describe('classifyLaunchLogCause', () => {
  test('recognises port and lock signatures, and leaves other logs unclassified', () => {
    expect(
      classifyLaunchLogCause(['Error: listen EADDRINUSE: address already in use :::8090']),
    ).toBe('port_in_use');
    expect(classifyLaunchLogCause(['別のインスタンスが既に起動しています'])).toBe('lock_held');
    expect(classifyLaunchLogCause(['Another next dev server is already running.'])).toBe(
      'lock_held',
    );
    expect(classifyLaunchLogCause(['TypeError: x is not a function'])).toBeUndefined();
  });
});
