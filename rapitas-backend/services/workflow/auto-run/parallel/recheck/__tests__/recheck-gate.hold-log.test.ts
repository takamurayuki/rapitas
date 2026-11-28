/**
 * recheck-gate.hold-log.test
 *
 * Task 1572, F2: the held row and the cycle log are recorded under separate
 * conditions. A failed held-row write is retried on the next evaluation of the
 * same reason (the row compares with the DB, not with memory), while the cycle
 * log still appears once per reason. A restart (empty hold table) with the
 * same reason already stored adds nothing, and a failed read of the stored
 * signature writes no row.
 *
 * Run on its own: bun's mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import {
  newWorld,
  gateDeps,
  mark,
  plan,
  rowsOf,
  runningSet,
  IMPLEMENTER,
  THEME1,
  type World,
} from './recheck-fake.test-support';

mock.module('../../../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
const events: Array<{ evt: string; fields: Record<string, unknown> }> = [];
mock.module('../../../../../observability', () => ({
  logCycleEvent: (evt: string, fields: Record<string, unknown>) => events.push({ evt, fields }),
}));

const { guardParallelRecheck } = await import('../recheck-gate');
const { resetRecheckHoldState, isParallelRecheckHeld } = await import('../recheck-state');

let w: World;
const run = () =>
  guardParallelRecheck(20, IMPLEMENTER, THEME1, 'plan_approved' as never, 'standard', gateDeps(w));
const heldRows = () => rowsOf(w, 20, 'parallel_recheck_held');
const logs = () => events.filter((e) => e.fields.cause === 'parallel_recheck_hold');

beforeEach(() => {
  events.length = 0;
  resetRecheckHoldState();
  w = newWorld();
  w.sets[1] = runningSet(10, 20);
  mark(w, 20, 5_000);
  // 20 overlaps the head on one file → held every time.
  w.plans[10] = plan('rapitas-backend/services/alpha/a.ts');
  w.plans[20] = plan('rapitas-backend/services/alpha/a.ts');
});

describe('F2 — the held row is retried, the log is not repeated', () => {
  test('(a) a failed held-row write is written on the next evaluation of the same reason', async () => {
    w.createFails = true;
    expect(await run()).toMatchObject({ done: true });
    expect(heldRows()).toHaveLength(0);
    expect(logs()).toHaveLength(1);

    w.createFails = false;
    w.clock += 10_000;
    expect(await run()).toMatchObject({ done: true });
    expect(heldRows()).toHaveLength(1);
    expect(JSON.parse(heldRows()[0]!.metadata)).toMatchObject({
      opponentTaskId: 10,
      files: ['rapitas-backend/services/alpha/a.ts'],
    });
    expect(logs()).toHaveLength(1);
    expect(isParallelRecheckHeld(20)).toBe(true);
  });

  test('(b) a third evaluation of the same reason adds nothing', async () => {
    w.createFails = true;
    await run();
    w.createFails = false;
    await run();
    await run();
    expect(heldRows()).toHaveLength(1);
    expect(logs()).toHaveLength(1);
  });

  test('(c) after a restart (empty table) the stored reason adds no row and no log', async () => {
    await run();
    expect(heldRows()).toHaveLength(1);
    expect(logs()).toHaveLength(1);
    resetRecheckHoldState();
    await run();
    expect(heldRows()).toHaveLength(1);
    expect(logs()).toHaveLength(1);
  });

  test('(d) a failed read of the stored signature writes no row; the log appears once', async () => {
    w.heldReadFails = true;
    expect(await run()).toMatchObject({ done: true });
    await run();
    expect(heldRows()).toHaveLength(0);
    expect(logs()).toHaveLength(1);
    w.heldReadFails = false;
    await run();
    expect(heldRows()).toHaveLength(1);
    expect(logs()).toHaveLength(1);
  });

  test('a changed reason writes one row and one log', async () => {
    await run();
    w.plans[10] = plan('rapitas-backend/services/alpha/a.ts', 'rapitas-desktop/src/x/y.ts');
    w.plans[20] = plan('rapitas-backend/services/alpha/a.ts', 'rapitas-desktop/src/x/y.ts');
    await run();
    expect(heldRows()).toHaveLength(2);
    expect(logs()).toHaveLength(2);
  });
});
