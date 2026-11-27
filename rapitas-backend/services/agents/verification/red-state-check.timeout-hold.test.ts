/**
 * red-state-check.timeout-hold.test
 *
 * Task 1553 R6: a red-state test run that times out returns 124 at once
 * (the check then fails open), but must keep the cross-task heavy slot until
 * its child really closes — the old runShell resolved on timeout and the
 * surrounding withHeavyCheckSlot freed the slot while the tree still ran.
 *
 * Run this file on its own: bun's mock.module is process-global and this
 * file replaces the logger.
 */
import { describe, test, expect, mock, beforeEach, afterEach, afterAll } from 'bun:test';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { runRedStateTestCommand } = await import('./red-state-check');
const { runCmd } = await import('./verify-command-runner');
const { heavyCheckSlotStats, resetHeavyCheckSlotForTests } = await import('./heavy-check-slot');

/** A child that never closes by itself and ignores kill. */
function stubbornChild(pid: number) {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  return child;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => resetHeavyCheckSlotForTests());
afterEach(() => resetHeavyCheckSlotForTests());
afterAll(() => mock.restore());

describe('runRedStateTestCommand (task 1553 R6)', () => {
  test('a timed-out red-state run holds the slot until its child closes', async () => {
    const first = stubbornChild(8001);
    const killed: Array<number | undefined> = [];
    const r1 = runRedStateTestCommand('bun test --isolate "a.test.ts"', 'C:/scratch', {
      timeoutMs: 50,
      spawn: () => first as unknown as ChildProcess,
      killTree: (c) => killed.push(c.pid),
      killGraceMs: 10_000,
    });
    const spy2 = mock(() => {
      const c = stubbornChild(8002);
      setTimeout(() => c.emit('close', 0), 5);
      return c as unknown as ChildProcess;
    });
    const r2 = runCmd('next heavy', 'C:/proj', { heavy: true, spawn: spy2 });

    expect(await r1).toBe(124); // the caller then fails open, as before
    await wait(30);
    expect(spy2).not.toHaveBeenCalled();
    expect(heavyCheckSlotStats().active).toBe(1);
    expect(killed).toEqual([8001]);

    first.emit('close', 1);
    expect((await r2).code).toBe(0);
    expect(spy2).toHaveBeenCalledTimes(1);
    expect(heavyCheckSlotStats()).toEqual({ active: 0, waiting: 0 });
  });

  test('a normal run returns its exit code and frees the slot', async () => {
    const child = stubbornChild(8003);
    const code = await runRedStateTestCommand('bun test --isolate "b.test.ts"', 'C:/scratch', {
      spawn: () => {
        setTimeout(() => child.emit('close', 0), 5);
        return child as unknown as ChildProcess;
      },
    });
    expect(code).toBe(0);
    expect(heavyCheckSlotStats()).toEqual({ active: 0, waiting: 0 });
  });
});
