/**
 * recheck-gate.test
 *
 * Task 1572: the implementer re-check of a companion selected without a plan.
 * Pass / hold with the opponent and files in the held row and the cycle log,
 * one record per reason, mode-aware artifacts, missing candidate files, the
 * mark and membership conditions, and the release once the opponent leaves.
 * Mutual waits are in recheck-gate.mutual.test.ts.
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
const { isParallelRecheckHeld, getRecheckHold, resetRecheckHoldState } =
  await import('../recheck-state');

let w: World;
const run = (taskId = 20, mode: string | null = 'standard', role = IMPLEMENTER) =>
  guardParallelRecheck(taskId, role, THEME1, 'plan_approved' as never, mode, gateDeps(w));
const holds = () => events.filter((e) => e.fields.cause === 'parallel_recheck_hold');
const heldMeta = (taskId = 20) =>
  rowsOf(w, taskId, 'parallel_recheck_held').map((r) => JSON.parse(r.metadata));

beforeEach(() => {
  events.length = 0;
  resetRecheckHoldState();
  w = newWorld();
  // Head 10 runs; companion 20 was selected without a plan and has planned since.
  w.sets[1] = runningSet(10, 20);
  mark(w, 20, 5_000);
  w.plans[10] = plan('rapitas-backend/services/alpha/a.ts');
  w.plans[20] = plan('rapitas-frontend/src/beta/b.tsx');
});

describe('pass and hold', () => {
  test('no overlap → proceeds and writes one passed row', async () => {
    expect(await run()).toEqual({ done: false });
    expect(rowsOf(w, 20, 'parallel_recheck_passed')).toHaveLength(1);
    expect(holds()).toEqual([]);
    expect(isParallelRecheckHeld(20)).toBe(false);
  });

  test('overlap → held; opponent and file in the metadata and in the cycle log', async () => {
    w.plans[20] = plan('rapitas-backend/services/alpha/a.ts');
    const r = await run();
    expect(r).toMatchObject({ done: true, result: { skipped: true, status: 'plan_approved' } });
    expect(r.done && r.result.held).toContain('task 10');
    expect(heldMeta()).toEqual([
      expect.objectContaining({
        opponentTaskId: 10,
        reason: 'file_overlap',
        files: ['rapitas-backend/services/alpha/a.ts'],
        exemptFromTenure: true,
      }),
    ]);
    expect(holds()).toHaveLength(1);
    expect(holds()[0]!.fields).toMatchObject({
      task: 20,
      opponent: 10,
      reason: 'file_overlap',
      files: ['rapitas-backend/services/alpha/a.ts'],
    });
    expect(isParallelRecheckHeld(20)).toBe(true);
    expect(rowsOf(w, 20, 'parallel_recheck_passed')).toHaveLength(0);
  });

  test('the same reason twice adds no row and no log line', async () => {
    w.plans[20] = plan('rapitas-backend/services/alpha/a.ts');
    await run();
    w.clock += 10_000;
    await run();
    expect(heldMeta()).toHaveLength(1);
    expect(holds()).toHaveLength(1);
  });

  test('the same reason after a restart (empty hold table) adds nothing either', async () => {
    w.plans[20] = plan('rapitas-backend/services/alpha/a.ts');
    await run();
    resetRecheckHoldState();
    await run();
    expect(heldMeta()).toHaveLength(1);
    expect(holds()).toHaveLength(1);
  });

  test('a changed reason adds exactly one row', async () => {
    w.plans[20] = plan('rapitas-backend/services/alpha/a.ts');
    await run();
    w.plans[10] = plan('rapitas-backend/services/alpha/a.ts', 'rapitas-desktop/src/x/y.ts');
    w.plans[20] = plan('rapitas-backend/services/alpha/a.ts', 'rapitas-desktop/src/x/y.ts');
    await run();
    expect(heldMeta().map((m) => m.files)).toEqual([
      ['rapitas-backend/services/alpha/a.ts'],
      ['rapitas-backend/services/alpha/a.ts', 'rapitas-desktop/src/x/y.ts'],
    ]);
    expect(holds()).toHaveLength(2);
  });

  test('a dependency on the running task holds even without shared files', async () => {
    w.tasks[20] = { description: 'タスク10に依存する' };
    expect(await run()).toMatchObject({ done: true });
    expect(heldMeta()[0]).toMatchObject({ opponentTaskId: 10, reason: 'dependency_text' });
  });

  test('a failed held-row write keeps holding', async () => {
    w.plans[20] = plan('rapitas-backend/services/alpha/a.ts');
    w.createFails = true;
    expect(await run()).toMatchObject({ done: true });
    expect(holds()).toHaveLength(1);
  });
});

describe('what is compared (by workflow mode)', () => {
  test('a standard opponent with only research.md is waited on', async () => {
    w.plans[10] = null;
    w.research[10] = plan('rapitas-desktop/src/other/z.ts');
    expect(await run()).toMatchObject({ done: true });
    expect(heldMeta()[0]).toMatchObject({ opponentTaskId: 10, reason: 'active_plan_missing' });
    expect(isParallelRecheckHeld(20)).toBe(true);
  });

  test('a lightweight opponent is compared on its research.md', async () => {
    w.tasks[10] = { workflowMode: 'lightweight' };
    w.plans[10] = null;
    w.research[10] = plan('rapitas-desktop/src/other/z.ts');
    expect(await run()).toEqual({ done: false });
    w.research[10] = plan('rapitas-frontend/src/beta/b.tsx');
    w.transitions = w.transitions.filter((r) => r.cause !== 'parallel_recheck_passed');
    expect(await run()).toMatchObject({ done: true });
    expect(heldMeta()[0]).toMatchObject({ reason: 'file_overlap', opponentTaskId: 10 });
  });

  test('a standard candidate without plan.md is held, not exempt from the tenure wall', async () => {
    w.plans[20] = null;
    w.research[20] = plan('rapitas-frontend/src/beta/b.tsx');
    expect(await run()).toMatchObject({ done: true });
    expect(heldMeta()[0]).toMatchObject({
      reason: 'candidate_files_missing',
      exemptFromTenure: false,
    });
    expect(getRecheckHold(20)?.exempt).toBe(false);
    expect(isParallelRecheckHeld(20)).toBe(false);
  });

  test('a lightweight candidate (research_done) is compared on its research.md', async () => {
    w.plans[20] = null;
    w.research[20] = plan('rapitas-frontend/src/beta/b.tsx');
    expect(
      await guardParallelRecheck(
        20,
        IMPLEMENTER,
        THEME1,
        'research_done' as never,
        'lightweight',
        gateDeps(w),
      ),
    ).toEqual({ done: false });
    expect(rowsOf(w, 20, 'parallel_recheck_passed')).toHaveLength(1);
  });
});

describe('when the gate applies', () => {
  test('another role is never checked', async () => {
    w.plans[20] = plan('rapitas-backend/services/alpha/a.ts');
    expect(
      await run(20, 'standard', { role: 'planner', nextStatus: 'plan_created' } as never),
    ).toEqual({
      done: false,
    });
    expect(w.setReads).toBe(0);
  });

  test('no mark → proceeds without reading the running set', async () => {
    w.transitions = [];
    w.plans[20] = plan('rapitas-backend/services/alpha/a.ts');
    expect(await run()).toEqual({ done: false });
    expect(w.setReads).toBe(0);
  });

  test('a consumed mark (passed) is not checked again', async () => {
    await run();
    w.plans[20] = plan('rapitas-backend/services/alpha/a.ts');
    const reads = w.setReads;
    expect(await run()).toEqual({ done: false });
    expect(w.setReads).toBe(reads);
  });

  test('not in the running set any more → proceeds', async () => {
    w.sets[1] = runningSet(10);
    w.plans[20] = plan('rapitas-backend/services/alpha/a.ts');
    expect(await run()).toEqual({ done: false });
  });

  test('an unreadable running set → held (no exemption)', async () => {
    w.sets[1] = { ...runningSet(10, 20), readable: false };
    expect(await run()).toMatchObject({ done: true });
    expect(getRecheckHold(20)).toMatchObject({ exempt: false });
  });

  test('a rejected mark read → held (no exemption)', async () => {
    w.markReadFails = true;
    expect(await run()).toMatchObject({ done: true });
    expect(getRecheckHold(20)).toMatchObject({ exempt: false });
    expect(holds()[0]!.fields).toMatchObject({ reason: 'mark_read_failed' });
  });

  test('a failed passed-row write proceeds, and the next advance re-checks', async () => {
    w.createFails = true;
    expect(await run()).toEqual({ done: false });
    const reads = w.setReads;
    w.createFails = false;
    expect(await run()).toEqual({ done: false });
    expect(w.setReads).toBe(reads + 1);
  });
});

describe('release', () => {
  test('held while the opponent runs, proceeds once it left the running set', async () => {
    w.plans[20] = plan('rapitas-backend/services/alpha/a.ts');
    expect(await run()).toMatchObject({ done: true });
    w.sets[1] = runningSet(20); // 10 finished; 20 was promoted to head
    expect(await run()).toEqual({ done: false });
    expect(rowsOf(w, 20, 'parallel_recheck_passed')).toHaveLength(1);
    expect(isParallelRecheckHeld(20)).toBe(false);
  });
});
