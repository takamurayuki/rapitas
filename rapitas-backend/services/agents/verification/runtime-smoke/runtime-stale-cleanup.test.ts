/**
 * runtime-stale-cleanup.test
 *
 * Injected process lists, listener tables and launch history prove that only
 * processes the history shows this launch family started are stopped, and that
 * everything else (manual services, siblings, port 3001, unidentifiable or
 * re-used PIDs) is left alone and reported as an environment cause.
 */
import { describe, expect, test } from 'bun:test';
import {
  cleanupStaleRuntime,
  extractStartPorts,
  fixedPortOf,
  extractFixedPorts,
  type StaleCleanupDeps,
} from './runtime-stale-cleanup';
import { normalizeForMatch, tokenizeCommandLine } from './runtime-command-match';
import type { LaunchRecord } from './runtime-launch-history';
import type { RuntimeProcessIdentity } from './runtime-process-identity';
import type { RuntimeProcessSnapshot } from './runtime-process-snapshot';

const WORKDIR = 'C:/w/task-15';
const LOCK_PATH = `${WORKDIR}/.next/dev/lock`;
const proc = (pid: number, command: string, parentPid = 1): RuntimeProcessIdentity => ({
  pid,
  parentPid,
  birth: String(1000 + pid),
  command,
});
/** A history record exactly as the launch would have written it for `row`. */
const rec = (row: RuntimeProcessIdentity, role: 'root' | 'observed' = 'root'): LaunchRecord => ({
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
const lockRec = (pid: number, birth: string): LaunchRecord => ({
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
const SERVER = proc(40, `"${WORKDIR}/server.exe" --serve`);
const CFG = { url: 'http://127.0.0.1:8090', start: 'server' };
const NO_PORT = { url: 'http://127.0.0.1:{port}', start: 'server {port}' };

interface WorldOptions {
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
function world(
  initial: RuntimeProcessIdentity[],
  listeners: Array<{ port: number; pid: number }>,
  opts: WorldOptions = {},
) {
  let rows = [...initial];
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
    readHistory: async () => opts.history ?? [],
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

describe('fixedPortOf / extractStartPorts', () => {
  test('read pinned ports and ignore placeholders', () => {
    expect(fixedPortOf('http://127.0.0.1:{port}')).toBeNull();
    expect(fixedPortOf('http://127.0.0.1')).toBeNull();
    expect(fixedPortOf('not a url')).toBeNull();
    expect(fixedPortOf('http://localhost:8090/x')).toBe(8090);
    expect(extractStartPorts('server.exe --port 8090')).toEqual([8090]);
    expect(extractStartPorts('next dev -p 3000')).toEqual([3000]);
    expect(extractStartPorts('set PORT=4000 && node a.js')).toEqual([4000]);
    expect(extractStartPorts('serve 127.0.0.1:5000')).toEqual([5000]);
    expect(extractStartPorts('next dev -p {port}')).toEqual([]);
    expect(
      extractFixedPorts({ url: 'http://localhost:8090', start: 'server --port 9000' }),
    ).toEqual([8090]);
    expect(extractStartPorts('server --port 1')).toEqual([1]);
    expect(extractStartPorts('server --port 65536')).toEqual([]);
    expect(extractStartPorts('server --listen :8090 http://[::1]:8091')).toEqual([8090, 8091]);
  });
});

describe('cleanupStaleRuntime — only what the launch history proves', () => {
  test('stops a recorded leftover that holds the fixed port', async () => {
    const { deps, killed } = world([SERVER], [{ port: 8090, pid: 40 }], { history: [rec(SERVER)] });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: true,
      stoppedPids: [40],
    });
    expect(killed).toEqual([40]);
  });

  test('a manually started service in the same worktree (no record) is never stopped', async () => {
    const manual = proc(41, `"${WORKDIR}/server.exe" --serve`);
    const { deps, killed } = world([manual], [{ port: 8090, pid: 41 }], { history: [] });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'port_in_use',
    });
    expect(killed).toEqual([]);
  });

  test('missing or unreadable history means nothing is stopped', async () => {
    const { deps, killed } = world([SERVER], [{ port: 8090, pid: 40 }]);
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'port_in_use',
    });
    expect(killed).toEqual([]);
  });

  test.each([
    ['a space', `"C:/w/task-15 other/server.exe" --serve`],
    ['a comma', `"C:/w/task-15,other/server.exe" --serve`],
    ['a longer sibling', `"C:/w/task-153/server.exe" --serve`],
  ])('a different program whose path only contains %s is not the recorded one', async (_n, cmd) => {
    const impostor = proc(40, cmd);
    // The record holds the genuine argv for PID 40 / birth 1040.
    const { deps, killed } = world([impostor], [{ port: 8090, pid: 40 }], {
      history: [rec(SERVER)],
    });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'foreign_process',
    });
    expect(killed).toEqual([]);
  });

  test('a re-used PID (same number, new birth) is not stopped', async () => {
    const reused = { ...proc(40, 'C:/elsewhere/new.exe'), birth: '9999' };
    const { deps, killed } = world([reused], [{ port: 8090, pid: 40 }], { history: [rec(SERVER)] });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'foreign_process',
    });
    expect(killed).toEqual([]);
  });

  test('a PID re-used between the listing and the stop is not signalled', async () => {
    const { deps, killed } = world([SERVER], [{ port: 8090, pid: 40 }], { history: [rec(SERVER)] });
    const reused = { ...proc(40, 'C:/elsewhere/new.exe'), birth: '9999' };
    const later = async (): Promise<RuntimeProcessSnapshot> => ({
      processes: [reused],
      protectedPids: new Set(),
      listeners: [{ port: 8090, pid: 40 }],
    });
    const first = deps.snapshot;
    let calls = 0;
    deps.snapshot = async () => (calls++ === 0 ? first() : later());
    deps.stopDeps!.snapshot = later;
    const result = await cleanupStaleRuntime(WORKDIR, CFG, deps);
    expect(killed).toEqual([]);
    expect(result).toMatchObject({ ok: false, cause: 'foreign_process' });
  });

  test('a fixed port shared by a recorded leftover and a stranger stops nothing at all', async () => {
    const stranger = proc(50, 'C:/elsewhere/app.exe');
    const { deps, killed } = world(
      [SERVER, stranger],
      [
        { port: 8090, pid: 40 },
        { port: 8090, pid: 50 },
      ],
      { history: [rec(SERVER)] },
    );
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({ ok: false });
    expect(killed).toEqual([]);
  });

  test('a protected process sharing a recorded tree stops nothing', async () => {
    const backend = proc(41, 'bun backend', 40);
    const { deps, killed } = world([SERVER, backend], [{ port: 8090, pid: 40 }], {
      history: [rec(SERVER)],
      protectedPids: [41],
    });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'foreign_process',
    });
    expect(killed).toEqual([]);
  });

  test('port 3001 and its owner are refused even when recorded', async () => {
    const backend = proc(30, `bun ${WORKDIR}/rapitas-backend/index.ts`);
    const base = world([backend], [{ port: 3001, pid: 30 }], {
      history: [rec(backend)],
      protectedPids: [30],
    });
    expect(
      await cleanupStaleRuntime(WORKDIR, { url: 'http://127.0.0.1:3001', start: 's' }, base.deps),
    ).toMatchObject({ ok: false, cause: 'port_in_use' });
    // Recorded and holding the fixed port, but it is the backend: not proven.
    const other = world([backend], [{ port: 8090, pid: 30 }], {
      history: [rec(backend)],
      protectedPids: [30],
    });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, other.deps)).toMatchObject({
      ok: false,
      cause: 'port_in_use',
    });
    expect(base.killed).toEqual([]);
    expect(other.killed).toEqual([]);
  });

  test('this process and its ancestors are never stopped, whatever the history says', async () => {
    const self = proc(process.pid, `bun test ${WORKDIR}`, 700);
    const ancestor = proc(700, `claude --cwd ${WORKDIR}`);
    const { deps, killed } = world(
      [self, ancestor],
      [
        { port: 8090, pid: process.pid },
        { port: 8091, pid: 700 },
      ],
      { history: [rec(self), rec(ancestor)] },
    );
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({ ok: false });
    expect(killed).toEqual([]);
  });

  test('a process owned by another active borrower is never stopped', async () => {
    const { deps, killed } = world([SERVER], [{ port: 8090, pid: 40 }], {
      history: [rec(SERVER)],
      excludePids: [40],
    });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({ ok: false });
    expect(killed).toEqual([]);
  });

  test('a child that only holds the port is stopped through its live recorded root', async () => {
    const root = proc(40, `cmd /c "${WORKDIR}/start.bat"`);
    const child = proc(45, 'server.exe', 40);
    const { deps, killed } = world([root, child], [{ port: 8090, pid: 45 }], {
      history: [rec(root, 'root')],
    });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({ ok: true });
    expect(killed).toContain(45);
  });

  test('an observed child is stopped even after its root died', async () => {
    const child = proc(45, 'server.exe --serve', 40);
    const { deps, killed } = world([child], [{ port: 8090, pid: 45 }], {
      history: [rec(proc(40, 'cmd /c start.bat'), 'root'), rec(child, 'observed')],
    });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({ ok: true });
    expect(killed).toEqual([45]);
  });

  test('an unrecorded child of a dead root is not stopped', async () => {
    const child = proc(45, 'server.exe --serve', 40);
    const { deps, killed } = world([child], [{ port: 8090, pid: 45 }], {
      history: [rec(proc(40, 'cmd /c start.bat'), 'root')],
    });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'port_in_use',
    });
    expect(killed).toEqual([]);
  });

  test('停止を確認できなければ foreign_process を返す', async () => {
    const { deps } = world([SERVER], [{ port: 8090, pid: 40 }], {
      history: [rec(SERVER)],
      unkillable: true,
    });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'foreign_process',
    });
  });

  test('an unanswered listener table cannot prove the fixed port is free', async () => {
    const { deps } = world([], []);
    deps.snapshot = async () => ({ processes: [], protectedPids: new Set() });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'port_in_use',
    });
  });

  test('ポートが未指定でも履歴由来の残存プロセスを回収する', async () => {
    const stray = proc(41, `node ${WORKDIR}/other.js`);
    const { deps, killed } = world([stray], [{ port: 9099, pid: 41 }], { history: [rec(stray)] });
    expect(await cleanupStaleRuntime(WORKDIR, NO_PORT, deps)).toMatchObject({
      ok: true,
      stoppedPids: [41],
    });
    expect(killed).toEqual([41]);
  });
});

describe('cleanupStaleRuntime — runtime lock', () => {
  test('a live lock holder proven by the history is stopped', async () => {
    const next = proc(61, `node "${WORKDIR}/node_modules/next/dist/bin/next" dev`);
    const { deps, killed } = world([next], [], {
      history: [rec(next), lockRec(61, next.birth)],
      lock: { pid: 61 },
    });
    expect(await cleanupStaleRuntime(WORKDIR, NO_PORT, deps)).toMatchObject({
      ok: true,
      stoppedPids: [61],
    });
    expect(killed).toEqual([61]);
  });

  test('a live holder with no record keeps the lock and stops nothing', async () => {
    const holder = proc(60, 'C:/elsewhere/next.exe');
    const { deps, killed } = world([SERVER, holder], [{ port: 8090, pid: 40 }], {
      history: [rec(SERVER)],
      lock: { pid: 60 },
    });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'lock_held',
    });
    expect(killed).toEqual([]);
  });

  test('a lock whose recorded holder was replaced by a new process is foreign_process', async () => {
    const reused = { ...proc(60, 'C:/elsewhere/new.exe'), birth: '7777' };
    const { deps, killed } = world([reused], [], {
      history: [lockRec(60, '1060')],
      lock: { pid: 60 },
    });
    expect(await cleanupStaleRuntime(WORKDIR, NO_PORT, deps)).toMatchObject({
      ok: false,
      cause: 'foreign_process',
    });
    expect(killed).toEqual([]);
  });

  test('a lock in an unknown format is never touched', async () => {
    const { deps, killed, removed } = world([SERVER], [{ port: 8090, pid: 40 }], {
      history: [rec(SERVER)],
      lock: { unknown: true },
    });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'lock_held',
    });
    expect(killed).toEqual([]);
    expect(removed).toEqual([]);
  });

  test('a recorded lock whose holder is dead is removed, once re-read', async () => {
    const { deps, removed } = world([], [], { history: [lockRec(60, '1060')], lockFilePid: 60 });
    expect(await cleanupStaleRuntime(WORKDIR, NO_PORT, deps)).toMatchObject({
      ok: true,
      removedLocks: [LOCK_PATH],
    });
    expect(removed).toEqual([LOCK_PATH]);
  });

  test('a lock rewritten by a new owner after the record is not removed', async () => {
    const { deps, removed } = world([], [], { history: [lockRec(60, '1060')], lockFilePid: 99 });
    expect(await cleanupStaleRuntime(WORKDIR, NO_PORT, deps)).toMatchObject({
      ok: false,
      cause: 'lock_held',
    });
    expect(removed).toEqual([]);
  });

  test('a dead-owner lock with no record is left alone', async () => {
    const { deps, removed } = world([], [], { lockFilePid: 60 });
    expect(await cleanupStaleRuntime(WORKDIR, NO_PORT, deps)).toMatchObject({
      ok: false,
      cause: 'lock_held',
    });
    expect(removed).toEqual([]);
  });

  test('a recorded lock whose holder is still the same live process is kept', async () => {
    const holder = proc(60, 'C:/elsewhere/next.exe');
    const { deps, removed } = world([holder], [], {
      history: [lockRec(60, '1060')],
      lockFilePid: 60,
    });
    await cleanupStaleRuntime(WORKDIR, NO_PORT, deps);
    expect(removed).toEqual([]);
  });
});

describe('差し戻しの停止境界と割り込み', () => {
  test('停止直前のコマンド表現が変わっても引数の完全一致で同じ身元を照合する', async () => {
    const { deps, killed } = world([SERVER], [{ port: 8090, pid: 40 }], {
      history: [rec(SERVER)],
    });
    const snapshot = deps.stopDeps!.snapshot;
    deps.stopDeps!.snapshot = async () => {
      const current = await snapshot();
      return {
        ...current,
        processes: current.processes.map((row) => ({
          ...row,
          command:
            process.platform === 'win32'
              ? '"c:\\w\\task-15\\SERVER.EXE" --serve'
              : `'${WORKDIR}/server.exe' --serve`,
        })),
      };
    };
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: true,
      stoppedPids: [40],
    });
    expect(killed).toEqual([40]);
  });
  test('区切りが異なる同じロックを重複削除しない', async () => {
    const { deps, removed } = world([], [], { history: [lockRec(60, '1060')], lockFilePid: 60 });
    deps.inspectDirectory = async () =>
      removed.length
        ? { free: true }
        : {
            free: true,
            locks: [
              { path: LOCK_PATH, pid: 60 },
              { path: LOCK_PATH.replaceAll('/', '\\'), pid: 60 },
            ],
          };
    expect(await cleanupStaleRuntime(WORKDIR, NO_PORT, deps)).toMatchObject({ ok: true });
    expect(removed).toEqual([LOCK_PATH]);
  });
  test('既知の生存ロックと未知の死亡ロックが混在しても全体を拒否する', async () => {
    const { deps, killed, removed } = world([SERVER], [{ port: 8090, pid: 40 }], {
      history: [rec(SERVER), lockRec(40, SERVER.birth)],
      lock: { pid: 40 },
    });
    deps.inspectDirectory = async () => ({
      free: false,
      path: LOCK_PATH,
      pid: 40,
      locks: [
        { path: LOCK_PATH, pid: 40 },
        { path: `${WORKDIR}/.next/lock`, pid: 99 },
      ],
    });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'lock_held',
    });
    expect(killed).toEqual([]);
    expect(removed).toEqual([]);
  });
  test.each(['C:/elsewhere/lock', `${WORKDIR}/../other/lock`])(
    'worktree外の履歴ロックは読み書きしない: %s',
    async (lockPath) => {
      const { deps, removed } = world([], [], { history: [{ ...lockRec(60, '1060'), lockPath }] });
      const reads: string[] = [];
      deps.readLockPid = async (path) => {
        reads.push(path);
        return 60;
      };
      expect(await cleanupStaleRuntime(WORKDIR, NO_PORT, deps)).toMatchObject({ ok: true });
      expect(reads).toEqual([]);
      expect(removed).toEqual([]);
    },
  );
  test('全件停止の直前に身元が変わると一件も停止しない', async () => {
    const { deps, killed } = world([SERVER], [{ port: 8090, pid: 40 }], { history: [rec(SERVER)] });
    const view = deps.stopDeps!.snapshot;
    let calls = 0;
    deps.stopDeps!.snapshot = async () => {
      const snapshot = await view();
      return ++calls === 1
        ? snapshot
        : { ...snapshot, processes: [{ ...SERVER, command: 'another.exe' }] };
    };
    deps.stopDeps!.terminateMany = async (identities) => {
      killed.push(...identities.map((p) => p.pid));
    };
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'foreign_process',
    });
    expect(killed).toEqual([]);
  });
  test('別の active 借り手が子孫に含まれる場合は全体を停止しない', async () => {
    const child = proc(41, 'other active server', 40);
    const { deps, killed } = world([SERVER, child], [{ port: 8090, pid: 40 }], {
      history: [rec(SERVER)],
      excludePids: [41],
    });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'foreign_process',
    });
    expect(killed).toEqual([]);
  });
  test('根が死亡した observed プロセスの未記録子孫を停止しない', async () => {
    const child = proc(45, 'server.exe', 40);
    const grandchild = proc(46, 'unknown.exe', 45);
    const { deps, killed } = world([child, grandchild], [{ port: 8090, pid: 45 }], {
      history: [rec(SERVER), rec(child, 'observed')],
    });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: true,
      stoppedPids: [45],
    });
    expect(killed).toEqual([45]);
  });
  test('プロセス履歴だけではロックを所有した証明にならない', async () => {
    const { deps, killed, removed } = world([SERVER], [{ port: 8090, pid: 40 }], {
      history: [rec(SERVER)],
      lock: { pid: 40 },
    });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'lock_held',
    });
    expect(killed).toEqual([]);
    expect(removed).toEqual([]);
  });
  test('未知の死亡ロックがあれば既知のポート所有者も停止しない', async () => {
    const { deps, killed } = world([SERVER], [{ port: 8090, pid: 40 }], {
      history: [rec(SERVER)],
      lockFilePid: 60,
    });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'lock_held',
    });
    expect(killed).toEqual([]);
  });
  test('最初の一覧取得失敗は掃除せず起動を許可する', async () => {
    const { deps, killed } = world([], []);
    deps.snapshot = async () => {
      throw new Error('snapshot unavailable');
    };
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({ ok: true });
    expect(killed).toEqual([]);
  });
  test('別 worktree の履歴は停止根拠にしない', async () => {
    const { deps, killed } = world([SERVER], [{ port: 8090, pid: 40 }], {
      history: [{ ...rec(SERVER), workdir: 'c:/w/other' }],
    });
    expect(await cleanupStaleRuntime(WORKDIR, CFG, deps)).toMatchObject({
      ok: false,
      cause: 'port_in_use',
    });
    expect(killed).toEqual([]);
  });
  test('ロック削除直前に持ち主が変わると削除も起動もしない', async () => {
    const state: WorldOptions = { history: [lockRec(60, '1060')], lockFilePid: 60 };
    const { deps, removed } = world([], [], state);
    const remove = deps.removeLock;
    deps.removeLock = async (path, pid) => {
      state.lockFilePid = 99;
      return remove(path, pid);
    };
    expect(await cleanupStaleRuntime(WORKDIR, NO_PORT, deps)).toMatchObject({
      ok: false,
      cause: 'lock_held',
    });
    expect(removed).toEqual([]);
  });
});
