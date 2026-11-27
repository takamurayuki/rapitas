/**
 * test-triage.timeout-hold.test
 *
 * Task 1553 R6: a triage test run that times out returns 124 at once (still
 * "not failing"), but must keep the cross-task heavy slot until its child
 * really closes — the old runner resolved on timeout and the surrounding
 * withHeavyCheckSlot freed the slot while the killed tree was still running.
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

const { runTriageTestCommand } = await import('./test-triage');
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

describe('runTriageTestCommand (task 1553 R6)', () => {
  test('a timed-out triage run holds the slot until its child closes', async () => {
    const first = stubbornChild(7001);
    const killed: Array<number | undefined> = [];
    const r1 = runTriageTestCommand('bun test --isolate "a.test.ts"', 'C:/proj', {
      timeoutMs: 50,
      spawn: () => first as unknown as ChildProcess,
      killTree: (c) => killed.push(c.pid),
      killGraceMs: 10_000,
    });
    const spy2 = mock(() => {
      const c = stubbornChild(7002);
      setTimeout(() => c.emit('close', 0), 5);
      return c as unknown as ChildProcess;
    });
    const r2 = runCmd('next heavy', 'C:/proj', { heavy: true, spawn: spy2 });

    expect((await r1).code).toBe(124); // returned at once, still "not failing"
    await wait(30);
    expect(spy2).not.toHaveBeenCalled();
    expect(heavyCheckSlotStats().active).toBe(1);
    expect(killed).toEqual([7001]);

    first.emit('close', 1);
    expect((await r2).code).toBe(0);
    expect(spy2).toHaveBeenCalledTimes(1);
    expect(heavyCheckSlotStats()).toEqual({ active: 0, waiting: 0 });
  });

  test('a normal run returns its exit code and frees the slot', async () => {
    const child = stubbornChild(7003);
    const r = runTriageTestCommand('bun test --isolate "b.test.ts"', 'C:/proj', {
      spawn: () => {
        setTimeout(() => child.emit('close', 1), 5);
        return child as unknown as ChildProcess;
      },
    });
    expect((await r).code).toBe(1);
    expect(heavyCheckSlotStats()).toEqual({ active: 0, waiting: 0 });
  });
});
