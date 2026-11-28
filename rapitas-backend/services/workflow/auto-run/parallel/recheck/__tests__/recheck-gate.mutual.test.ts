/**
 * recheck-gate.mutual.test
 *
 * Task 1572: two marked companions that collide never wait on each other.
 * The older mark (then the smaller task id) passes first, in the same theme
 * and across themes on the same repository, whichever is evaluated first; the
 * newer one passes once the older has left the running set.
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
  THEME2,
  type World,
} from './recheck-fake.test-support';

mock.module('../../../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('../../../../../observability', () => ({ logCycleEvent: () => {} }));

const { guardParallelRecheck } = await import('../recheck-gate');
const { resetRecheckHoldState } = await import('../recheck-state');

let w: World;
const run = (taskId: number, task = THEME1) =>
  guardParallelRecheck(
    taskId,
    IMPLEMENTER,
    task,
    'plan_approved' as never,
    'standard',
    gateDeps(w),
  );
const opponentOf = (taskId: number) =>
  rowsOf(w, taskId, 'parallel_recheck_held').map((r) => JSON.parse(r.metadata).opponentTaskId);

const SHARED = 'rapitas-backend/services/alpha/a.ts';

beforeEach(() => {
  resetRecheckHoldState();
  w = newWorld();
  w.plans[10] = plan('rapitas-desktop/src/head/h.ts');
  w.plans[20] = plan(SHARED);
  w.plans[30] = plan(SHARED);
});

describe('same theme', () => {
  beforeEach(() => {
    w.sets[1] = runningSet(10, 20, 30);
    mark(w, 20, 1_000);
    mark(w, 30, 2_000);
  });

  for (const order of [
    [30, 20],
    [20, 30],
  ]) {
    test(`evaluated ${order.join(' then ')}: the older passes, the newer waits on it`, async () => {
      const results: Record<number, boolean> = {};
      for (const id of order) results[id] = (await run(id)).done;
      expect(results).toEqual({ 20: false, 30: true });
      expect(opponentOf(30)).toEqual([20]);
      expect(rowsOf(w, 20, 'parallel_recheck_passed')).toHaveLength(1);
    });
  }

  test('the newer one passes after the older leaves the running set', async () => {
    await run(20);
    expect((await run(30)).done).toBe(true);
    w.sets[1] = runningSet(10, 30);
    expect(await run(30)).toEqual({ done: false });
  });

  test('the same mark time: the smaller task id goes first', async () => {
    w.transitions = [];
    mark(w, 20, 1_000);
    mark(w, 30, 1_000);
    expect((await run(30)).done).toBe(true);
    expect((await run(20)).done).toBe(false);
    expect(opponentOf(30)).toEqual([20]);
  });
});

describe('another theme on the same repository', () => {
  beforeEach(() => {
    w.sets[1] = runningSet(10, 20);
    w.sets[2] = runningSet(40, 30);
    w.plans[40] = plan('rapitas-mobile/lib/other/o.dart');
    w.peers[1] = [
      { themeId: 2, taskId: 40 },
      { themeId: 2, taskId: 30 },
    ];
    w.peers[2] = [
      { themeId: 1, taskId: 10 },
      { themeId: 1, taskId: 20 },
    ];
    mark(w, 20, 1_000);
    mark(w, 30, 2_000);
  });

  for (const order of [
    [30, 20],
    [20, 30],
  ]) {
    test(`evaluated ${order.join(' then ')}: the older passes, the newer waits`, async () => {
      const results: Record<number, boolean> = {};
      for (const id of order) results[id] = (await run(id, id === 20 ? THEME1 : THEME2)).done;
      expect(results).toEqual({ 20: false, 30: true });
      expect(opponentOf(30)).toEqual([20]);
    });
  }

  test('the newer one passes after the older leaves', async () => {
    await run(20, THEME1);
    expect((await run(30, THEME2)).done).toBe(true);
    w.peers[2] = [{ themeId: 1, taskId: 10 }];
    expect(await run(30, THEME2)).toEqual({ done: false });
  });
});
