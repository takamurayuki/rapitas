/**
 * runtime-smoke/runtime-server-registry-lifecycle.test
 *
 * Covers spawnNewEntry()'s identity-unconfirmed failure path: the spawned
 * child process must be stopped even when the post-spawn OS snapshot never
 * confirms its identity (task 1044 — "Spawned process identity cannot be
 * confirmed" was thrown before entry.identities was ever set, so the
 * existing stopOwnedAndVerify() cleanup silently skipped, leaking the child).
 */
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
mock.module('./runtime-process-snapshot', () => ({
  ownsRuntimePort: () => false,
  readRuntimeProcessSnapshot: async () => {
    snapshotCalls++;
    if (snapshotFailAfterCall !== null && snapshotCalls > snapshotFailAfterCall) {
      const failuresSoFar = snapshotCalls - snapshotFailAfterCall;
      if (snapshotFailCount === null || failuresSoFar <= snapshotFailCount) {
        throw new Error('INJECTED_SNAPSHOT_TIMEOUT');
      }
    }
    return {
      processes: rootPresent ? [{ pid: 999, parentPid: 1, birth: '100', command: 'owned' }] : [],
      protectedPids: new Set(),
      listeners: [],
    };
  },
}));

mock.module('./runtime-config', () => ({
  substitutePort: (s: string, p: number) => s.replaceAll('{port}', String(p)),
}));

let stopSpy = 0;
let exited = false;
mock.module('./app-launcher', () => ({
  allocateFreePort: async () => 45999,
  launchApp: () => ({
    pid: 999,
    logs: () => (exited ? ['Error: Cannot find module cross-env'] : []),
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
    return !shouldAbort?.();
  },
}));

/** How long the mocked health poll stays in its loop (lets the 2.5s tracker tick). */
let healthyDelayMs = 0;

const { spawnNewEntry } = await import('./runtime-server-registry-lifecycle');
const { registry, nextGeneration: _unused } = await import('./runtime-server-registry-types');

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
  exited = false;
  snapshotCalls = 0;
  snapshotFailAfterCall = null;
  snapshotFailCount = null;
  healthyDelayMs = 0;
  registry.clear();
});

// task 1055 (2026-09-24/25): `next dev` exited 1 on a missing module before
// the identity snapshot; the reservation stayed quarantined ("前回の停止確認が
// 取れず隔離中") and every later verification of the worktree was unverifiable.
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

// 2026-09-27: the ownership tracker's OS snapshot was killed at its 10 s ceiling
// while a dev server compiled, and that single failure aborted the launch — the
// reason runtime smoke had not verified once since 09-22. A snapshot that cannot
// be TAKEN is infrastructure, not evidence that ownership is unsafe.
test('one failed ownership snapshot does not abort the launch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-identity-'));
  temporaryWorkdirs.push(dir);
  rootPresent = true;
  healthyDelayMs = 6_000;
  // Calls 1-2 are the pre-start and post-spawn snapshots; fail the next one only.
  snapshotFailAfterCall = 2;
  snapshotFailCount = 1;

  const result = await spawnNewEntry(dir, dir, { ...cfg, readyTimeoutMs: 8_000 }, 'fp');

  // This harness cannot carry a launch all the way to success (port ownership is
  // stubbed false), so assert the thing this change governs: the transient
  // snapshot failure is NOT what ended the launch.
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
  registry.clear();
  for (const dir of temporaryWorkdirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

test('spawn stops the launched process when its OS identity is never confirmed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-identity-'));
  temporaryWorkdirs.push(dir);

  // rootPresent stays false: the post-spawn snapshot never contains the
  // launched PID, so spawnNewEntry() throws 'Spawned process identity
  // cannot be confirmed' before entry.identities is ever set.
  const result = await spawnNewEntry(dir, dir, cfg, 'fp');

  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).toContain('identity cannot be confirmed');
  expect(stopSpy).toBe(1);
});
