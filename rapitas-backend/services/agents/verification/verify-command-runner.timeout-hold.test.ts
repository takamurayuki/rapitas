/**
 * verify-command-runner.timeout-hold.test
 *
 * Task 1553 R2: after a heavy command times out, the caller gets code 124 at
 * once but the slot stays held until the child really ends ('close' /
 * 'error') or a kill grace limit passes. Releasing at the timeout let the
 * next heavy command start while the timed-out tsc/bun grandchildren were
 * still running (peak 2, found in verification).
 *
 * Run this file on its own: bun's mock.module is process-global and this
 * file replaces the logger.
 */
import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';
import { EventEmitter } from 'events';
import type { ChildProcess, SpawnOptions } from 'child_process';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { runCmd } = await import('./verify-command-runner');
const { heavyCheckSlotStats, resetHeavyCheckSlotForTests, setHeavySlotEventSinkForTests } =
  await import('./heavy-check-slot');

interface FakeChild extends EventEmitter {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => boolean;
}

/** A child that never ends by itself and ignores kill; tests emit 'close' by hand. */
function stubbornChild(pid: number): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  return child;
}

/** A child that closes with code 0 after `ms`. */
function quickChild(pid: number, ms: number): FakeChild {
  const child = stubbornChild(pid);
  setTimeout(() => child.emit('close', 0), ms);
  return child;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  delete process.env.RAPITAS_VERIFY_HEAVY_CONCURRENCY;
  resetHeavyCheckSlotForTests();
});

afterAll(() => {
  resetHeavyCheckSlotForTests();
  mock.restore();
});

describe('runCmd timeout keeps the heavy slot until the child ends (task 1553 R2)', () => {
  test('the next heavy command waits for the timed-out child to close', async () => {
    const first = stubbornChild(111);
    const killed: number[] = [];
    let secondStarted = false;
    const r1 = await runCmd('tsc', 'C:/a', {
      heavy: true,
      timeoutMs: 30,
      killGraceMs: 10_000,
      spawn: () => first as unknown as ChildProcess,
      killTree: (c) => killed.push(c.pid ?? -1),
    });
    expect(r1.code).toBe(124); // the caller is not kept waiting
    expect(killed).toEqual([111]);

    const p2 = runCmd('tsc', 'C:/b', {
      heavy: true,
      spawn: (_c: string, _o: SpawnOptions) => {
        secondStarted = true;
        return quickChild(222, 5) as unknown as ChildProcess;
      },
    });
    await wait(40);
    expect(secondStarted).toBe(false); // first tree still alive → slot still held
    expect(heavyCheckSlotStats()).toEqual({ active: 1, waiting: 1 });

    first.emit('close', 1);
    expect((await p2).code).toBe(0);
    expect(secondStarted).toBe(true);
    expect(heavyCheckSlotStats()).toEqual({ active: 0, waiting: 0 });
  });

  test('without a close, the slot is released after the kill grace limit', async () => {
    const first = stubbornChild(333);
    await runCmd('tsc', 'C:/a', {
      heavy: true,
      timeoutMs: 20,
      killGraceMs: 60,
      spawn: () => first as unknown as ChildProcess,
      killTree: () => {},
    });
    let secondStarted = false;
    const p2 = runCmd('tsc', 'C:/b', {
      heavy: true,
      spawn: () => {
        secondStarted = true;
        return quickChild(444, 5) as unknown as ChildProcess;
      },
    });
    await wait(20);
    expect(secondStarted).toBe(false);
    expect((await p2).code).toBe(0);
    expect(secondStarted).toBe(true);
  });

  test('close and the grace limit both firing never drive the count negative', async () => {
    const first = stubbornChild(555);
    await runCmd('tsc', 'C:/a', {
      heavy: true,
      timeoutMs: 10,
      killGraceMs: 30,
      spawn: () => first as unknown as ChildProcess,
      killTree: () => {},
    });
    await wait(50); // grace fired
    first.emit('close', 1); // late close
    first.emit('error', new Error('late'));
    expect(heavyCheckSlotStats()).toEqual({ active: 0, waiting: 0 });
  });

  test('a throwing killTree does not break the release', async () => {
    const first = stubbornChild(666);
    const r = await runCmd('tsc', 'C:/a', {
      heavy: true,
      timeoutMs: 10,
      killGraceMs: 10_000,
      spawn: () => first as unknown as ChildProcess,
      killTree: () => {
        throw new Error('taskkill missing');
      },
    });
    expect(r.code).toBe(124);
    first.emit('close', 1);
    expect(heavyCheckSlotStats()).toEqual({ active: 0, waiting: 0 });
  });
});

describe('kill grace release reaches the cycle log (task 1553 R7)', () => {
  test('releasing after the grace limit records verify.heavy_slot_kill_grace_release once', async () => {
    const events: Array<{ evt: string; fields: Record<string, unknown> }> = [];
    setHeavySlotEventSinkForTests((evt, fields) => events.push({ evt, fields }));
    const first = stubbornChild(777);
    await runCmd('bun test --isolate "slow.test.ts"', 'C:/a', {
      heavy: true,
      timeoutMs: 10,
      killGraceMs: 100,
      spawn: () => first as unknown as ChildProcess,
      killTree: () => {},
    });
    await wait(150);
    expect(events.length).toBe(1);
    expect(events[0]!.evt).toBe('verify.heavy_slot_kill_grace_release');
    expect(events[0]!.fields).toMatchObject({
      cause: 'kill_grace_elapsed',
      command: 'bun test --isolate "slow.test.ts"',
      waitedMs: 100,
      pid: 777,
    });
  });

  test('a close before the grace limit records nothing', async () => {
    const events: string[] = [];
    setHeavySlotEventSinkForTests((evt) => events.push(evt));
    const first = stubbornChild(778);
    await runCmd('tsc', 'C:/a', {
      heavy: true,
      timeoutMs: 10,
      killGraceMs: 100,
      spawn: () => first as unknown as ChildProcess,
      killTree: () => {},
    });
    first.emit('close', 1);
    await wait(150);
    expect(events).toEqual([]);
  });
});
