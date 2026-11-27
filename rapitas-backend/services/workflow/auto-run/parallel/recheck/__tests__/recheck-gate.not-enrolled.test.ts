/**
 * recheck-gate.not-enrolled.test
 *
 * Task 1572, G1: a task whose re-check mark is still unconsumed but that no
 * longer holds (or never got) a slot in its theme's running set is held as
 * `not_enrolled` — whichever way the slot was lost (auto-run stopped, the
 * selection undone, addCompanion failed). Opponents are not read, the reason
 * is recorded once, and once auto-run selects the task again the normal
 * re-check runs. A task without a mark is never held for this.
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
const { resetRecheckHoldState, getRecheckHold, isParallelRecheckHeld } =
  await import('../recheck-state');

let w: World;
let peerReads: number;
let artifactReads: number;
const run = () => {
  const d = gateDeps(w);
  return guardParallelRecheck(20, IMPLEMENTER, THEME1, 'plan_approved' as never, 'standard', {
    ...d,
    loadPeers: async (p, themeId) => {
      peerReads++;
      return d.loadPeers!(p, themeId);
    },
    readArtifact: async (taskId, type) => {
      artifactReads++;
      return d.readArtifact!(taskId, type);
    },
  });
};
const heldMeta = () => rowsOf(w, 20, 'parallel_recheck_held').map((r) => JSON.parse(r.metadata));
const logs = () => events.filter((e) => e.fields.cause === 'parallel_recheck_hold');

beforeEach(() => {
  events.length = 0;
  peerReads = 0;
  artifactReads = 0;
  resetRecheckHoldState();
  w = newWorld();
  w.sets[1] = runningSet(10, 20);
  mark(w, 20, 5_000);
  w.plans[10] = plan('rapitas-backend/services/alpha/a.ts');
  w.plans[20] = plan('rapitas-frontend/src/beta/b.tsx');
});

const LOST: Array<{ name: string; lose: () => void }> = [
  {
    name: '(a) auto-run stopped: the running set is cleared',
    lose: () => (w.sets[1] = runningSet(null)),
  },
  {
    name: '(b) the selection undone: the companion is released',
    lose: () => (w.sets[1] = runningSet(10)),
  },
  {
    name: '(c) addCompanion failed: the task never got a slot',
    lose: () => (w.sets[1] = { ...runningSet(10), raw: '[]' }),
  },
];

describe('G1 — an unconsumed mark without a slot holds the implementer', () => {
  for (const c of LOST) {
    test(`${c.name} → held as not_enrolled, opponents not read`, async () => {
      c.lose();
      const r = await run();
      expect(r).toMatchObject({ done: true, result: { skipped: true, status: 'plan_approved' } });
      expect(r.done && r.result.held).toContain('not_enrolled');
      expect(peerReads).toBe(0);
      expect(artifactReads).toBe(0);
      expect(heldMeta()).toEqual([
        expect.objectContaining({ opponentTaskId: null, reason: 'not_enrolled', files: [] }),
      ]);
      expect(logs()).toHaveLength(1);
      expect(logs()[0]!.fields).toMatchObject({ task: 20, reason: 'not_enrolled', opponent: null });
      expect(getRecheckHold(20)).toMatchObject({ exempt: false });
      expect(isParallelRecheckHeld(20)).toBe(false);
      expect(rowsOf(w, 20, 'parallel_recheck_passed')).toHaveLength(0);

      // The same state again adds neither a row nor a log line.
      w.clock += 10_000;
      expect(await run()).toMatchObject({ done: true });
      expect(heldMeta()).toHaveLength(1);
      expect(logs()).toHaveLength(1);
    });
  }

  test('(d) selected again without overlap → the re-check runs and passes', async () => {
    w.sets[1] = runningSet(null);
    expect(await run()).toMatchObject({ done: true });
    w.sets[1] = runningSet(10, 20);
    expect(await run()).toEqual({ done: false });
    expect(rowsOf(w, 20, 'parallel_recheck_passed')).toHaveLength(1);
    expect(getRecheckHold(20)).toBeUndefined();
  });

  test('(d) selected again as the head with overlap → held on the overlap instead', async () => {
    w.sets[1] = runningSet(null);
    await run();
    w.sets[1] = runningSet(20, 10);
    w.plans[20] = plan('rapitas-backend/services/alpha/a.ts');
    expect(await run()).toMatchObject({ done: true });
    expect(heldMeta().map((m) => m.reason)).toEqual(['not_enrolled', 'file_overlap']);
    expect(logs()).toHaveLength(2);
    expect(isParallelRecheckHeld(20)).toBe(true);
  });

  test('a task with no mark is not held even without a slot', async () => {
    w.transitions = [];
    w.sets[1] = runningSet(null);
    expect(await run()).toEqual({ done: false });
    expect(heldMeta()).toEqual([]);
  });

  test('a consumed mark (passed) is not held even without a slot', async () => {
    await run(); // passes while enrolled
    w.sets[1] = runningSet(null);
    expect(await run()).toEqual({ done: false });
    expect(heldMeta()).toEqual([]);
  });
});
