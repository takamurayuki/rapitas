/**
 * verify-command-runner.test
 *
 * Acceptance 1/2 of task 1553: two tasks verifying at once never run two
 * heavy commands simultaneously, and the time spent waiting for the slot is
 * not counted against the command's timeout. `heavy:false` is the control
 * that shows the pre-fix behaviour (both run at once).
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
const { heavyCheckSlotStats, resetHeavyCheckSlotForTests } = await import('./heavy-check-slot');

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: (sig?: string) => boolean;
  killed: boolean;
}

/** Fake spawn whose children close after `durationMs` (or never, when null). */
function fakeSpawner(durationMs: number | null) {
  let running = 0;
  let peak = 0;
  const children: FakeChild[] = [];
  const spawn = (_command: string, _opts: SpawnOptions): ChildProcess => {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    running++;
    peak = Math.max(peak, running);
    let ended = false;
    const end = (code: number) => {
      if (ended) return;
      ended = true;
      running--;
      child.emit('close', code);
    };
    child.kill = () => {
      child.killed = true;
      end(137);
      return true;
    };
    if (durationMs !== null) {
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from('ok'));
        end(0);
      }, durationMs);
    }
    children.push(child);
    return child as unknown as ChildProcess;
  };
  return { spawn, peak: () => peak, children };
}

beforeEach(() => {
  delete process.env.RAPITAS_VERIFY_HEAVY_CONCURRENCY;
  resetHeavyCheckSlotForTests();
});

afterAll(() => {
  resetHeavyCheckSlotForTests();
  mock.restore();
});

describe('runCmd heavy slot (task 1553)', () => {
  test('two parallel heavy commands never run at the same time', async () => {
    const f = fakeSpawner(40);
    const [a, b] = await Promise.all([
      runCmd('tsc', 'C:/a', { heavy: true, spawn: f.spawn, timeoutMs: 5_000 }),
      runCmd('tsc', 'C:/b', { heavy: true, spawn: f.spawn, timeoutMs: 5_000 }),
    ]);
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    expect(f.peak()).toBe(1);
    expect(heavyCheckSlotStats()).toEqual({ active: 0, waiting: 0 });
  });

  test('control: without heavy, both run at once (the pre-fix behaviour)', async () => {
    const f = fakeSpawner(40);
    await Promise.all([
      runCmd('tsc', 'C:/a', { heavy: false, spawn: f.spawn, timeoutMs: 5_000 }),
      runCmd('tsc', 'C:/b', { heavy: false, spawn: f.spawn, timeoutMs: 5_000 }),
    ]);
    expect(f.peak()).toBe(2);
  });

  test('waiting for the slot does not count against the timeout', async () => {
    // First command holds the slot for 300 ms; the second's own timeout is
    // 100 ms but its command takes only 20 ms once started → it must succeed.
    const slow = fakeSpawner(300);
    const fast = fakeSpawner(20);
    const [first, second] = await Promise.all([
      runCmd('bun test', 'C:/a', { heavy: true, spawn: slow.spawn, timeoutMs: 5_000 }),
      runCmd('tsc', 'C:/b', { heavy: true, spawn: fast.spawn, timeoutMs: 100 }),
    ]);
    expect(first.code).toBe(0);
    expect(second.code).not.toBe(124);
    expect(second.code).toBe(0);
  });

  test('the timeout still applies to the run itself and frees the slot', async () => {
    const hang = fakeSpawner(null);
    const res = await runCmd('tsc', 'C:/a', { heavy: true, spawn: hang.spawn, timeoutMs: 30 });
    expect(res.code).toBe(124);
    expect(hang.children[0]!.killed).toBe(true);
    // The kill emits close after the timeout already settled: count must stay 0, not go negative.
    expect(heavyCheckSlotStats()).toEqual({ active: 0, waiting: 0 });
    const next = fakeSpawner(5);
    expect((await runCmd('tsc', 'C:/b', { heavy: true, spawn: next.spawn })).code).toBe(0);
  });

  test('a spawn error releases the slot', async () => {
    const spawn = (_c: string, _o: SpawnOptions): ChildProcess => {
      const child = new EventEmitter() as FakeChild;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      setTimeout(() => child.emit('error', new Error('ENOENT')), 1);
      return child as unknown as ChildProcess;
    };
    const res = await runCmd('nope', 'C:/a', { heavy: true, spawn });
    expect(res.code).toBe(1);
    expect(heavyCheckSlotStats()).toEqual({ active: 0, waiting: 0 });
  });

  test('a throwing spawn resolves code 1 and releases the slot', async () => {
    const spawn = (): ChildProcess => {
      throw new Error('spawn failed');
    };
    const res = await runCmd('nope', 'C:/a', { heavy: true, spawn });
    expect(res.code).toBe(1);
    expect(heavyCheckSlotStats()).toEqual({ active: 0, waiting: 0 });
  });
});
