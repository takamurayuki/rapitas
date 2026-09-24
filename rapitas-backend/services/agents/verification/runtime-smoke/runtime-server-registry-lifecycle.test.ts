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
mock.module('./runtime-process-snapshot', () => ({
  ownsRuntimePort: () => false,
  readRuntimeProcessSnapshot: async () => ({
    processes: rootPresent ? [{ pid: 999, parentPid: 1, birth: '100', command: 'owned' }] : [],
    protectedPids: new Set(),
    listeners: [],
  }),
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
  waitForHealthy: async () => true,
}));

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
