/** 起動・残存回収・身元未確定時の停止と、並行要求の共有を検査する。 */
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLaunchHistory } from './runtime-launch-history';
import type { RuntimeProcessIdentity } from './runtime-process-identity';

const historyModule = { ...(await import('./runtime-launch-history')) };
let historyBarrier: Promise<void> | undefined;
let historyWrites = 0;
let historyWriteFails = false;
mock.module('./runtime-launch-history', () => ({
  ...historyModule,
  recordLaunchProcesses: async (
    ...args: Parameters<typeof historyModule.recordLaunchProcesses>
  ) => {
    historyWrites++;
    await historyBarrier;
    if (historyWriteFails)
      args[3] = {
        ...args[3],
        deps: {
          write: async () => {
            throw new Error('INJECTED_HISTORY_WRITE_FAILURE');
          },
        },
      };
    return historyModule.recordLaunchProcesses(...args);
  },
}));

mock.module('./runtime-boot-identity', () => ({
  readRuntimeBootId: async () => 'linux:00000000-0000-0000-0000-000000000001',
  isPriorRuntimeBoot: () => false,
  isRuntimeBootId: () => true,
}));

let rows: unknown[] = [];
mock.module('./runtime-registry-store', () => ({
  RuntimeRegistryStore: class {
    async read() {
      return rows;
    }
    async update(change: (rows: unknown[]) => unknown[]) {
      rows = change(rows);
    }
  },
}));

let rootPresent = false;
/** Snapshot calls after this many succeed reject instead, to drive the retry path. */
let snapshotFailAfterCall: number | null = null;
/** Snapshot calls that reject before succeeding again (null = keep failing). */
let snapshotFailCount: number | null = null;
let snapshotCalls = 0;
let ownsPort = false;
let allocatedPort = 45999;
let launchPort = 0;
const snapshotModule = { ...(await import('./runtime-process-snapshot')) };
/** A process on a fixed port that the injected OS reports (null = port free). */
let fixedPortHolder: { pid: number; command: string; port: number } | null = null;
mock.module('./runtime-process-snapshot', () => ({
  ownsRuntimePort: snapshotModule.ownsRuntimePort,
  readRuntimeProcessSnapshot: async () => {
    snapshotCalls++;
    if (snapshotFailAfterCall !== null && snapshotCalls > snapshotFailAfterCall) {
      const failuresSoFar = snapshotCalls - snapshotFailAfterCall;
      if (snapshotFailCount === null || failuresSoFar <= snapshotFailCount) {
        throw new Error('INJECTED_SNAPSHOT_TIMEOUT');
      }
    }
    const holder = fixedPortHolder;
    return {
      processes: [
        ...(rootPresent ? [{ pid: 999, parentPid: 1, birth: '100', command: 'owned' }] : []),
        ...(holder
          ? [{ pid: holder.pid, parentPid: 1, birth: '200', command: holder.command }]
          : []),
      ],
      protectedPids: new Set(),
      listeners: [
        ...(holder ? [{ port: holder.port, pid: holder.pid }] : []),
        ...(ownsPort && launched > 0 && rootPresent ? [{ port: launchPort, pid: 999 }] : []),
      ],
    };
  },
}));

mock.module('./runtime-config', () => ({
  substitutePort: (s: string, p: number) => s.replaceAll('{port}', String(p)),
}));

let launched = 0;
let stopSpy = 0;
let exited = false;
let exitLog = 'Error: Cannot find module cross-env';
mock.module('./app-launcher', () => ({
  allocateFreePort: async () => allocatedPort,
  launchApp: (_command: string, _workdir: string, port: number) => ({
    port: (launchPort = _command.includes('--port 8090') ? 8090 : port),
    pid: (launched++, 999),
    logs: () => (exited ? [exitLog] : []),
    hasExited: () => exited,
    exitCode: () => (exited ? 1 : null),
    markStopRequested: () => {},
    stop: () => {
      stopSpy++;
    },
  }),
  waitForHealthy: async (
    _url: string,
    _timeoutMs: number,
    _ctx?: Record<string, unknown>,
    shouldAbort?: () => boolean,
  ) => {
    // The real poll loop checks shouldAbort every iteration; mirror that so the
    // ownership tracker gets wall-clock ticks to run in.
    const deadline = Date.now() + healthyDelayMs;
    while (Date.now() < deadline) {
      if (shouldAbort?.()) return false;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await onReady?.();
    return !shouldAbort?.();
  },
}));

/** How long the mocked health poll stays in its loop (lets the 2.5s tracker tick). */
let healthyDelayMs = 0;
let onReady: (() => Promise<void>) | undefined;
const stoppedIdentities: RuntimeProcessIdentity[][] = [];

// Stub the OS-level stop so quarantine cleanup never shells out to PowerShell
// against the fake PID 999 used by this harness.
mock.module('./runtime-process-stop', () => ({
  terminateRuntimeIdentities: async () => ({ stopped: true, reason: '' }),
  stopRuntimeProcesses: async (
    identities: RuntimeProcessIdentity[],
    persist: (identities: RuntimeProcessIdentity[]) => Promise<void>,
  ) => {
    stoppedIdentities.push([...identities]);
    await persist(identities);
    if (identities.some((identity) => identity.pid === fixedPortHolder?.pid))
      fixedPortHolder = null;
    if (identities.some((identity) => identity.pid === 999)) rootPresent = false;
    return { stopped: true, identities, reason: '' };
  },
}));

const loggedErrors: Array<{ fields: Record<string, unknown>; msg: string }> = [];
const realLogger = await import('../../../../config/logger');
mock.module('../../../../config/logger', () => ({
  ...realLogger,
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    debug: () => {},
    error: (fields: Record<string, unknown>, msg: string) => loggedErrors.push({ fields, msg }),
  }),
}));

const { spawnNewEntry, stopOwnedAndVerify } = await import('./runtime-server-registry-lifecycle');
const { registry, nextGeneration: _unused } = await import('./runtime-server-registry-types');
const { acquireRuntimeServer, _resetForTests } = await import('./worktree-server-registry');
const persistence = await import('./runtime-server-registry-persistence');
const originalFetch = globalThis.fetch;

const cfg = {
  start: 'server {port}',
  url: 'http://127.0.0.1:{port}',
  healthPath: '/',
  readyTimeoutMs: 100,
  checkPaths: ['/'],
};

const temporaryWorkdirs: string[] = [];

beforeEach(() => {
  rows = [];
  rootPresent = false;
  stopSpy = 0;
  launched = 0;
  exited = false;
  exitLog = 'Error: Cannot find module cross-env';
  snapshotCalls = 0;
  fixedPortHolder = null;
  snapshotFailAfterCall = null;
  snapshotFailCount = null;
  healthyDelayMs = 0;
  onReady = undefined;
  ownsPort = false;
  allocatedPort = 45999;
  launchPort = 0;
  historyBarrier = undefined;
  historyWrites = 0;
  historyWriteFails = false;
  stoppedIdentities.length = 0;
  _resetForTests();
  loggedErrors.length = 0;
});

test('a launch that already exited is released, not quarantined', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-identity-'));
  temporaryWorkdirs.push(dir);
  exited = true;

  const result = await spawnNewEntry(dir, dir, cfg, 'fp');

  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).toContain('起動に失敗');
  expect(JSON.stringify(result)).toContain('cross-env');
  expect(registry.has(dir)).toBe(false);
  expect(rows).toHaveLength(0);
});

test('a launch whose process may still be alive stays quarantined', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-identity-'));
  temporaryWorkdirs.push(dir);

  await spawnNewEntry(dir, dir, cfg, 'fp');

  expect(registry.get(dir)?.state).toBe('quarantined');
  expect(stopSpy).toBe(1);
});

test('one failed ownership snapshot does not abort the launch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-identity-'));
  temporaryWorkdirs.push(dir);
  rootPresent = true;
  healthyDelayMs = 6_000;
  // Calls 1-2 are the pre-start and post-spawn snapshots; fail the next one only.
  snapshotFailAfterCall = 2;
  snapshotFailCount = 1;

  const result = await spawnNewEntry(dir, dir, { ...cfg, readyTimeoutMs: 8_000 }, 'fp');

  expect(JSON.stringify(result)).not.toContain('INJECTED_SNAPSHOT_TIMEOUT');
}, 20_000);

test('an ownership snapshot that keeps failing still aborts the launch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-identity-'));
  temporaryWorkdirs.push(dir);
  rootPresent = true;
  healthyDelayMs = 10_000;
  snapshotFailAfterCall = 2;
  snapshotFailCount = null; // never recovers

  const result = await spawnNewEntry(dir, dir, { ...cfg, readyTimeoutMs: 12_000 }, 'fp');

  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).toContain('INJECTED_SNAPSHOT_TIMEOUT');
}, 25_000);

afterEach(async () => {
  _resetForTests();
  globalThis.fetch = originalFetch;
  for (const dir of temporaryWorkdirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

test('履歴保存中に停止要求が重なっても同じ停止処理を共有する', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-stop-race-'));
  temporaryWorkdirs.push(dir);
  const entry = {
    key: dir,
    workdir: dir,
    state: 'active' as const,
    configFingerprint: 'fp',
    leases: new Set<string>(),
    generation: 1,
    identities: [{ pid: 40, parentPid: 1, birth: '100', command: 'owned' }],
  };
  registry.set(dir, entry);
  let resume!: () => void;
  historyBarrier = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const first = stopOwnedAndVerify(entry, 'first');
  const second = stopOwnedAndVerify(entry, 'second');
  const shared = registry.get(dir)?.stopPromise;
  resume();
  await Promise.all([first, second]);
  expect(shared).toBeDefined();
  expect(stoppedIdentities).toHaveLength(1);
  expect(historyWrites).toBe(1);
});

test('所有記録を削除しても履歴一致の固定ポートを回収して起動する', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-history-spawn-'));
  temporaryWorkdirs.push(dir);
  fixedPortHolder = { pid: 40, command: 'server --port 8090', port: 8090 };
  await historyModule.recordLaunchProcesses(
    dir,
    [
      {
        pid: 40,
        parentPid: 1,
        birth: '200',
        command: fixedPortHolder.command,
      },
    ],
    'root',
  );
  await persistence.persistStartingIntent(dir, dir, 'old');
  expect(rows).toHaveLength(1);
  await persistence.persistRemoval(dir);
  expect(rows).toEqual([]);
  rootPresent = true;
  ownsPort = true;
  const result = await spawnNewEntry(
    dir,
    dir,
    {
      ...cfg,
      start: 'server --port 8090',
      url: 'http://127.0.0.1:8090',
    },
    'fp',
  );
  expect(result.ok).toBe(true);
  expect(result).toMatchObject({ port: 8090, baseUrl: 'http://127.0.0.1:8090' });
  expect(stoppedIdentities.flat().map((identity) => identity.pid)).toEqual([40]);
  expect(launched).toBe(1);
  expect(await readLaunchHistory(dir)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ pid: 40, role: 'root' }),
      expect.objectContaining({ pid: 999, role: 'root', fixedPorts: [8090] }),
    ]),
  );
});

test('履歴一致の死亡ロックを削除して起動する', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-lock-spawn-'));
  temporaryWorkdirs.push(dir);
  const lockPath = join(dir, '.next', 'dev', 'lock');
  await mkdir(join(dir, '.next', 'dev'), { recursive: true });
  await writeFile(lockPath, JSON.stringify({ pid: 60 }));
  await historyModule.recordLaunchLock(dir, { path: lockPath, pid: 60, birth: '100' });
  rootPresent = true;
  ownsPort = true;
  const result = await spawnNewEntry(dir, dir, cfg, 'fp');
  expect(result.ok).toBe(true);
  expect(launched).toBe(1);
  expect(stoppedIdentities).toEqual([]);
  expect(await readFile(lockPath, 'utf8').catch(() => null)).toBeNull();
});

test('残存ポートを掃除する並行取得は起動を一度だけ行う', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-concurrent-cleanup-'));
  temporaryWorkdirs.push(dir);
  fixedPortHolder = { pid: 40, command: 'server --port 8090', port: 8090 };
  await historyModule.recordLaunchProcesses(
    dir,
    [
      {
        pid: 40,
        parentPid: 1,
        birth: '200',
        command: fixedPortHolder.command,
      },
    ],
    'root',
  );
  rootPresent = true;
  ownsPort = true;
  globalThis.fetch = mock(async () => new Response('ready')) as unknown as typeof fetch;
  const fixedCfg = { ...cfg, start: 'server --port 8090', url: 'http://127.0.0.1:8090' };
  const results = await Promise.all([
    acquireRuntimeServer(dir, fixedCfg),
    acquireRuntimeServer(dir, fixedCfg),
  ]);
  expect(results.every((result) => result.ok)).toBe(true);
  expect(launched).toBe(1);
  expect(stoppedIdentities.flat().map((identity) => identity.pid)).toEqual([40]);
  expect(await readLaunchHistory(dir)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ pid: 40 }),
      expect.objectContaining({ pid: 999 }),
    ]),
  );
});

test.each([999, 4242])(
  '待受確認後のロック PID %i は起動所有者の場合だけ履歴に記録する',
  async (pid) => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime-ready-lock-'));
    temporaryWorkdirs.push(dir);
    const lockPath = join(dir, '.next', 'dev', 'lock');
    onReady = async () => {
      await mkdir(join(dir, '.next', 'dev'), { recursive: true });
      await writeFile(lockPath, JSON.stringify({ pid }));
    };
    rootPresent = true;
    ownsPort = true;
    if (pid === 4242) fixedPortHolder = { pid, command: 'manual-server', port: 9099 };
    expect((await spawnNewEntry(dir, dir, cfg, 'fp')).ok).toBe(true);
    const locks = (await readLaunchHistory(dir)).filter((record) => record.kind === 'lock');
    expect(locks.map((record) => record.pid)).toEqual(pid === 999 ? [999] : []);
  },
);

test('起動履歴の書込失敗後に残った待受プロセスは次回停止しない', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-history-failure-'));
  temporaryWorkdirs.push(dir);
  historyWriteFails = true;
  rootPresent = true;
  ownsPort = true;
  const fixedCfg = { ...cfg, start: 'server --port 8090', url: 'http://127.0.0.1:8090' };
  expect((await spawnNewEntry(dir, dir, fixedCfg, 'fp')).ok).toBe(true);
  expect(await readLaunchHistory(dir)).toEqual([]);
  _resetForTests();
  rows = [];
  rootPresent = false;
  fixedPortHolder = { pid: 999, command: 'owned', port: 8090 };
  const result = await spawnNewEntry(dir, dir, fixedCfg, 'fp');
  expect(result).toMatchObject({ ok: false, unverifiable: true, cause: 'port_in_use' });
  expect(stoppedIdentities).toEqual([]);
  expect(launched).toBe(1);
});

test('spawn stops the launched process when its OS identity is never confirmed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-identity-'));
  temporaryWorkdirs.push(dir);

  const result = await spawnNewEntry(dir, dir, cfg, 'fp');

  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).toContain('identity cannot be confirmed');
  expect(stopSpy).toBe(1);
});

test('unconfirmed listener ownership is unverifiable and logs PID diagnostics with a fixed message', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-identity-'));
  temporaryWorkdirs.push(dir);
  rootPresent = true;

  const result = await spawnNewEntry(dir, dir, cfg, 'fp');

  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).toContain('Listener ownership is unconfirmed');
  expect(JSON.stringify(result)).toContain('"unverifiable":true');
  const entry = loggedErrors.find((e) => e.msg.includes('workdir quarantined'));
  expect((entry?.fields.err as Error).message).toBe('Listener ownership is unconfirmed');
  expect(entry?.fields.diagnostics).toEqual({
    port: 45999,
    listenerPids: [],
    ownedPids: [999],
    listenersKnown: true,
  });
});

test('a fixed port held by a process the launch history does not know is an environment cause', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-identity-'));
  temporaryWorkdirs.push(dir);
  fixedPortHolder = { pid: 4242, command: 'C:\elsewhere\server.exe', port: 8090 };

  const result = await spawnNewEntry(
    dir,
    dir,
    { ...cfg, start: 'server', url: 'http://127.0.0.1:8090' },
    'fp',
  );

  expect(result).toMatchObject({ ok: false, unverifiable: true, cause: 'port_in_use' });
  expect(launched).toBe(0);
  expect(registry.has(dir)).toBe(false);
});

test.each([
  ['Error: listen EADDRINUSE: address already in use :::8090', 'port_in_use'],
  ['別のインスタンスが既に起動しています', 'lock_held'],
])('a launch that exits on "%s" carries cause %s', async (line, cause) => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-identity-'));
  temporaryWorkdirs.push(dir);
  exited = true;
  exitLog = line;

  const result = await spawnNewEntry(dir, dir, cfg, 'fp');

  expect(result).toMatchObject({ ok: false, unverifiable: true, cause });
});

test('the spawned root is written to the launch history right after spawn', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-identity-'));
  temporaryWorkdirs.push(dir);
  rootPresent = true;

  await spawnNewEntry(dir, dir, cfg, 'fp');

  const history = await readLaunchHistory(dir);
  expect(history.find((r) => r.pid === 999)).toMatchObject({ kind: 'process', role: 'root' });
});
