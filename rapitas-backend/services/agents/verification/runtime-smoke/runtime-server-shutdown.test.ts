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

test('active, starting and identified-quarantined entries are stopped; unidentified quarantine skipped; idle timers cancelled', async () => {
  const a = entry('a', 'active');
  const b = entry('b', 'starting');
  entry('q', 'quarantined');
  const held = entry('held', 'quarantined');
  held.identities = [{ pid: 4242, birth: '1', command: 'next dev' } as never];
  const result = await stopAllRuntimeServersForShutdown('backend restart');
  expect(result).toEqual({ attempted: 3, stopped: 3, timedOut: false });
  expect(stopCalls.map((c) => c.key).sort()).toEqual(['a', 'b', 'held']);
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

// 2026-11-23 00:08: a deploy restarted the backend while task 1307's runtime
// check was still in `starting`. The sweep handed the entry to
// stopOwnedAndVerify, which quarantines an entry without identities and
// returns — the spawn went ahead after the sweep, the preview (pnpm → vite)
// inherited the dying backend's socket, and port 3001 stayed LISTENING under
// a dead pid until it was stopped by hand.
test('a starting entry is cancelled so its spawn cannot go ahead after the sweep', async () => {
  stopImpl = async () => false; // the real stopOwnedAndVerify without identities
  const s = entry('s', 'starting');
  await stopAllRuntimeServersForShutdown('backend restart');
  expect(s.startCancelled).toBe(true);
});

test('a starting entry that already spawned has its process tree stopped', async () => {
  stopImpl = async () => false;
  const s = entry('s', 'starting');
  const stop = mock(() => {});
  s.app = { stop, pid: 4321, logs: () => [], hasExited: () => false, exitCode: () => null };
  await stopAllRuntimeServersForShutdown('backend restart');
  expect(stop).toHaveBeenCalledTimes(1);
});

test('an active entry is not cancelled or stopped through the start path', async () => {
  const a = entry('a', 'active');
  const stop = mock(() => {});
  a.app = { stop, pid: 1, logs: () => [], hasExited: () => false, exitCode: () => null };
  await stopAllRuntimeServersForShutdown('backend restart');
  expect(a.startCancelled).toBeUndefined();
  expect(stop).not.toHaveBeenCalled();
});
