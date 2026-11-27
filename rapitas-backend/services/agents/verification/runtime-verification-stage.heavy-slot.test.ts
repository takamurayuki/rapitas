/**
 * runtime-verification-stage.heavy-slot.test
 *
 * Task 1553 R1: the runtime check (launch, browser check, lease release) is
 * a heavy check. While one task's runtime runs, another task's tsc
 * (`runCmd({heavy:true})`) must wait; the runtime itself starts only after
 * the slot is granted, so slot waiting never eats its own time limits.
 *
 * Run this file on its own: bun's mock.module is process-global and this
 * file replaces runtime-smoke and the logger.
 */
import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

let running = 0;
let peak = 0;
let runtimeStartedAt = 0;
let resolveRuntime: (() => void) | null = null;
let throwRuntime = false;
const RUNTIME_RESULT = { name: 'runtime', ran: true, ok: true, errorCount: 0, details: 'ok' };

/** Stand-in for the real smoke check; resolves when the test says so. */
async function fakeRuntimeSmokeCheck() {
  runtimeStartedAt = Date.now();
  if (throwRuntime) throw new Error('launch exploded');
  running++;
  peak = Math.max(peak, running);
  await new Promise<void>((r) => {
    resolveRuntime = r;
  });
  running--;
  return RUNTIME_RESULT;
}

// Mirror every runtime-smoke export the stage can reach.
mock.module('./runtime-smoke', () => ({
  runRuntimeSmokeCheck: fakeRuntimeSmokeCheck,
  evaluateSmokeFindings: () => ({ ok: true, findings: [] }),
}));

const { runRuntimeVerificationStage } = await import('./runtime-verification-stage');
const { runCmd } = await import('./verify-command-runner');
const { acquireHeavyCheckSlot, heavyCheckSlotStats, resetHeavyCheckSlotForTests } =
  await import('./heavy-check-slot');

/** A fake tsc that counts toward `running` while alive. */
function fakeTscSpawn() {
  return (): ChildProcess => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    running++;
    peak = Math.max(peak, running);
    setTimeout(() => {
      running--;
      child.emit('close', 0);
    }, 10);
    return child as unknown as ChildProcess;
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  delete process.env.RAPITAS_VERIFY_HEAVY_CONCURRENCY;
  resetHeavyCheckSlotForTests();
  running = 0;
  peak = 0;
  resolveRuntime = null;
  throwRuntime = false;
});

afterAll(() => {
  resetHeavyCheckSlotForTests();
  mock.restore();
});

describe('runtime check holds the heavy slot (task 1553 R1)', () => {
  test("another task's tsc waits while a runtime check runs (max 1 at a time)", async () => {
    const stage = runRuntimeVerificationStage('C:/wt-a', 1);
    await wait(10);
    let tscStarted = false;
    const spawn = fakeTscSpawn();
    const tsc = runCmd('tsc', 'C:/wt-b', {
      heavy: true,
      spawn: (c, o) => {
        tscStarted = true;
        return spawn(c, o);
      },
    });
    await wait(30);
    expect(tscStarted).toBe(false);
    resolveRuntime!();
    expect(await stage).toEqual(RUNTIME_RESULT);
    expect((await tsc).code).toBe(0);
    expect(tscStarted).toBe(true);
    expect(peak).toBe(1);
    expect(heavyCheckSlotStats()).toEqual({ active: 0, waiting: 0 });
  });

  test('control: the bare smoke check (pre-fix stage) overlaps a heavy tsc (max 2)', async () => {
    const bare = fakeRuntimeSmokeCheck();
    await wait(5);
    await runCmd('tsc', 'C:/wt-b', { heavy: true, spawn: fakeTscSpawn() });
    resolveRuntime!();
    await bare;
    expect(peak).toBe(2);
  });

  test('the runtime check starts only after a held slot is released', async () => {
    const holder = await acquireHeavyCheckSlot('tsc of another task');
    const releasedAt = Date.now() + 50;
    setTimeout(holder, 50);
    const stage = runRuntimeVerificationStage('C:/wt-a', 2);
    await wait(80);
    expect(runtimeStartedAt).toBeGreaterThanOrEqual(releasedAt - 5);
    resolveRuntime!();
    await stage;
  });

  test('a throwing runtime check frees the slot and still reports unverifiable', async () => {
    throwRuntime = true;
    const res = await runRuntimeVerificationStage('C:/wt-a', 3);
    expect(res).toMatchObject({ name: 'runtime', ran: false, unverifiable: true });
    expect(heavyCheckSlotStats()).toEqual({ active: 0, waiting: 0 });
  });
});
