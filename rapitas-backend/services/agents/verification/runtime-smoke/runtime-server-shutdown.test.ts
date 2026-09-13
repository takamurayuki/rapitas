/**
 * runtime-server-shutdown tests — every owned preview is stopped before exit,
 * quarantined entries are left alone, and a hung stop cannot outlive the bound.
 */
import { afterEach, expect, mock, test } from 'bun:test';
import { registry, type RegistryEntry } from './runtime-server-registry-types';

let stopCalls: Array<{ key: string; reason: string }> = [];
let stopImpl: (entry: RegistryEntry) => Promise<boolean> = async () => true;
mock.module('./runtime-server-registry-lifecycle', () => ({
  stopOwnedAndVerify: async (entry: RegistryEntry, reason: string) => {
    stopCalls.push({ key: entry.key, reason });
    return stopImpl(entry);
  },
}));
const { stopAllRuntimeServersForShutdown } = await import('./runtime-server-shutdown');

function entry(key: string, state: RegistryEntry['state']): RegistryEntry {
  const e: RegistryEntry = {
    key,
    workdir: `C:/wt/${key}`,
    state,
    configFingerprint: 'fp',
    leases: new Set(),
    generation: 1,
    idleTimer: setTimeout(() => {}, 60_000),
  };
  registry.set(key, e);
  return e;
}

afterEach(() => {
  for (const e of registry.values()) if (e.idleTimer) clearTimeout(e.idleTimer);
  registry.clear();
  stopCalls = [];
  stopImpl = async () => true;
});

test('no entries → nothing attempted', async () => {
  expect(await stopAllRuntimeServersForShutdown()).toEqual({
    attempted: 0,
    stopped: 0,
    timedOut: false,
  });
});

test('active and starting entries are stopped, quarantined ones skipped, idle timers cancelled', async () => {
  const a = entry('a', 'active');
  const b = entry('b', 'starting');
  entry('q', 'quarantined');
  const result = await stopAllRuntimeServersForShutdown('backend restart');
  expect(result).toEqual({ attempted: 2, stopped: 2, timedOut: false });
  expect(stopCalls.map((c) => c.key).sort()).toEqual(['a', 'b']);
  expect(stopCalls.every((c) => c.reason === 'backend restart')).toBe(true);
  expect(a.idleTimer).toBeUndefined();
  expect(b.idleTimer).toBeUndefined();
});

test('an unconfirmed stop is counted as not stopped, never thrown', async () => {
  entry('a', 'active');
  entry('b', 'active');
  stopImpl = async (e) => (e.key === 'a' ? true : Promise.reject(new Error('boom')));
  expect(await stopAllRuntimeServersForShutdown()).toEqual({
    attempted: 2,
    stopped: 1,
    timedOut: false,
  });
});

test('a hung stop is bounded by the timeout', async () => {
  entry('a', 'active');
  stopImpl = () => new Promise(() => {});
  const result = await stopAllRuntimeServersForShutdown('x', 50);
  expect(result).toEqual({ attempted: 1, stopped: 0, timedOut: true });
});
