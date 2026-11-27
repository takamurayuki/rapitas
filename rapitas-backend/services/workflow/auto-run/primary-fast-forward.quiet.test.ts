/**
 * primary-fast-forward.quiet.test
 *
 * 2026-11-27: once a restart was allowed, every idle 12-second scheduler tick
 * called fastForwardPrimary, and each call launched up to six git processes
 * plus a network fetch. An "up-to-date" answer is now reused for a while.
 */
import { describe, expect, test } from 'bun:test';
import { fastForwardPrimary, type GitRun } from './primary-fast-forward';

function upToDateRepo(calls: string[][]): GitRun {
  return async (args) => {
    calls.push(args);
    if (args[0] === 'status') return '';
    if (args[0] === 'rev-parse') return 'abc123\n';
    return '';
  };
}

describe('fastForwardPrimary — quiet period', () => {
  test('an up-to-date answer is reused within the quiet period, then git runs again', async () => {
    const calls: string[][] = [];
    const run = upToDateRepo(calls);
    let t = 1_000_000;
    const deps = { run, now: () => t, quietMs: 300_000 };
    expect((await fastForwardPrimary(deps)).reason).toBe('up-to-date');
    const first = calls.length;
    expect(first).toBeGreaterThan(0);
    t += 200_000;
    expect((await fastForwardPrimary(deps)).reason).toBe('up-to-date');
    expect(calls.length).toBe(first);
    t += 200_000;
    await fastForwardPrimary(deps);
    expect(calls.length).toBe(first * 2);
  });

  test('a failed fetch is not cached, so the next tick tries again', async () => {
    let fetches = 0;
    const run: GitRun = async (args) => {
      if (args[0] === 'status') return '';
      if (args[0] === 'fetch') {
        fetches++;
        throw new Error('offline');
      }
      return 'abc\n';
    };
    const deps = { run, now: () => 5_000_000, quietMs: 300_000 };
    expect((await fastForwardPrimary(deps)).reason).toBe('fetch-failed');
    expect((await fastForwardPrimary(deps)).reason).toBe('fetch-failed');
    expect(fetches).toBe(2);
  });
});
