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
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../../../../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../../../../../src/generated/sqlite-init-sql';
import type { RecheckGateTask } from '../recheck-gate';
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
const {
  resetRecheckHoldState,
  getRecheckHold,
  isParallelRecheckHeld,
  writePendingMark,
  readRecheckMark,
} = await import('../recheck-state');

let w: World;
let taskTheme: RecheckGateTask;
let peerReads: number;
let artifactReads: number;
const run = () => {
  const d = gateDeps(w);
  return guardParallelRecheck(20, IMPLEMENTER, taskTheme, 'plan_approved' as never, 'standard', {
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
  taskTheme = THEME1;
  w.sets[1] = runningSet(10, 20);
  mark(w, 20, 5_000);
  w.plans[10] = plan('rapitas-backend/services/alpha/a.ts');
  w.plans[20] = plan('rapitas-frontend/src/beta/b.tsx');
});

const LOST: Array<{ name: string; lose: () => void }> = [
  {
    name: 'G2: テーマ削除で themeId が null になる',
    lose: () => (taskTheme = { themeId: null, theme: null }),
  },
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

  test('G2: テーマなしでも印がなければ保留しない', async () => {
    taskTheme = { themeId: null, theme: null };
    w.transitions = [];
    expect(await run()).toEqual({ done: false });
    expect(w.setReads).toBe(0);
    expect(logs()).toEqual([]);
  });

  test('G2: 通過後にテーマを失っても印を再適用しない', async () => {
    expect(await run()).toEqual({ done: false });
    taskTheme = { themeId: null, theme: null };
    expect(await run()).toEqual({ done: false });
    expect(heldMeta()).toEqual([]);
  });
});

for (const mode of ['standard', 'comprehensive', 'lightweight']) {
  test(`G2 SQLite: ${mode} のテーマ削除後は保留し、再所属後に再確認する`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rapitas-1572-theme-loss-'));
    const path = join(dir, 'test.db');
    const init = new Database(path);
    try {
      // 初期スキーマを一括確定し、DDL ごとのディスク同期によるタイムアウトを防ぐ。
      init.transaction(() => init.exec(SQLITE_INIT_SQL))();
    } finally {
      init.close();
    }
    const db = new PrismaClient({ datasources: { db: { url: `file:${path}` } } });
    try {
      const theme = await db.theme.create({ data: { name: 'テーマ喪失試験' } });
      const status = mode === 'lightweight' ? 'research_done' : 'plan_approved';
      const task = await db.task.create({
        data: {
          title: '未消化の印',
          themeId: theme.id,
          workflowMode: mode,
          workflowStatus: status,
        },
      });
      await writePendingMark(db, { taskId: task.id, themeId: theme.id, workflowStatus: 'draft' });
      await db.theme.delete({ where: { id: theme.id } });
      const orphan = await db.task.findUniqueOrThrow({
        where: { id: task.id },
        include: { theme: true },
      });
      expect(orphan.themeId).toBeNull();
      expect((await readRecheckMark(db, task.id)).pending).toBe(true);
      const readSet = mock(async () => runningSet(task.id));
      const deps = {
        getPrisma: async () => db,
        readActiveSet: readSet,
        loadPeers: mock(async () => []),
        readArtifact: mock(async () => plan('rapitas-backend/services/alpha/a.ts')),
      };
      const evaluate = (t: RecheckGateTask) =>
        guardParallelRecheck(task.id, IMPLEMENTER, t, status, mode, deps);
      const heldRows = () =>
        db.workflowTransition.findMany({
          where: { taskId: task.id, cause: 'parallel_recheck_held' },
        });
      expect(await evaluate(orphan)).toMatchObject({ done: true, result: { skipped: true } });
      resetRecheckHoldState(); // 再起動相当でも同じ理由の記録を増やさない。
      expect(await evaluate(orphan)).toMatchObject({ done: true });
      const rows = await heldRows();
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]!.metadata!)).toMatchObject({
        reason: 'not_enrolled',
        opponentTaskId: null,
        files: [],
        exemptFromTenure: false,
      });
      expect(logs()).toHaveLength(1);
      expect(readSet).not.toHaveBeenCalled();
      expect(deps.loadPeers).not.toHaveBeenCalled();
      expect(deps.readArtifact).not.toHaveBeenCalled();
      expect((await readRecheckMark(db, task.id)).pending).toBe(true);

      const next = await db.theme.create({ data: { name: '再所属先' } });
      const enrolled = await db.task.update({
        where: { id: task.id },
        data: { themeId: next.id },
        include: { theme: true },
      });
      expect(await evaluate(enrolled)).toEqual({ done: false });
      expect(readSet).toHaveBeenCalledTimes(1);
      expect((await readRecheckMark(db, task.id)).pending).toBe(false);
    } finally {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
