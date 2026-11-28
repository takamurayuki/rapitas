/**
 * companion-selection.recheck-mark.test
 *
 * Task 1572, the re-check mark written at companion selection:
 *  - F1: whether a mark is needed follows the filter's own planless verdict,
 *    not a later re-read — a plan saved (or a status advanced) between the
 *    filter and the mark must not drop the mark, and a candidate admitted with
 *    a plan gets none even if its plan later reads as empty.
 *  - T1: the real writePendingMark failing refuses the slot; a mark written
 *    before a failed addCompanion is left behind, and the gate holds the
 *    implementer as `not_enrolled` because the task holds no slot (G1).
 *
 * Run on its own: bun's mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../../../../generated/prisma-postgres';
import { fakeThemeAutoRun, runningRow, type FakeRow } from './fake-theme-auto-run.test-support';

mock.module('../../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('../../../../observability', () => ({ logCycleEvent: () => {} }));
mock.module('../../../workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => ({ enqueue: async () => ({}) }) },
}));
mock.module('../../../../agents/stop-task-agents', () => ({
  stopTaskTreeAgents: async () => ({ executionIds: [] }),
}));

const { selectCompanionTask } = await import('../companion-selection');
const { guardParallelRecheck } = await import('../recheck/recheck-gate');

interface TaskRow {
  id: number;
  status: string;
  /** Values returned by successive findUnique reads; the last one repeats. */
  workflowStatus: Array<string | null>;
  description?: string;
}
interface Transition {
  taskId: number;
  cause: string;
  createdAt: Date;
  metadata: string;
}

let rows: FakeRow[];
let tasks: TaskRow[];
/** Values returned by successive readPlan calls per task; the last one repeats. */
let plans: Record<number, Array<string | null>>;
let transitions: Transition[];
let createFails: boolean;
let casFails: boolean;
let dependencyLinked: boolean;
const enqueued: number[] = [];
const casWrites: unknown[] = [];

const plan = (...files: string[]) => files.map((f) => `- \`${f}\``).join('\n');
const HEAD_FILE = 'rapitas-backend/services/alpha/a.ts';
const next = <T>(seq: T[], counter: Map<number, number>, id: number): T => {
  const n = counter.get(id) ?? 0;
  counter.set(id, n + 1);
  return seq[Math.min(n, seq.length - 1)]!;
};

function prisma(): PrismaClient {
  const fake = fakeThemeAutoRun(rows);
  const planReads = new Map<number, number>();
  const statusReads = new Map<number, number>();
  const model = {
    ...fake.model,
    updateMany: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      casWrites.push(a);
      return casFails ? { count: 0 } : fake.model.updateMany(a);
    },
  };
  const p = {
    userSettings: {
      findFirst: async () => ({ autoRunMaxConcurrency: 2, autoRunMaxConcurrencyPerTheme: 2 }),
    },
    themeAutoRun: model,
    workflowQueueItem: { count: async () => 1, findMany: async () => [] },
    theme: {
      findUnique: async () => ({ id: 1, workingDirectory: 'C:/Projects/rapitas' }),
      findMany: async () => [{ id: 1, workingDirectory: 'C:/Projects/rapitas' }],
    },
    taskDependency: { findFirst: async () => (dependencyLinked ? { id: 1 } : null) },
    agentExecution: { findMany: async () => [] },
    workflowTransition: {
      create: async (a: { data: Omit<Transition, 'createdAt'> }) => {
        if (createFails) throw new Error('db down');
        transitions.push({ ...a.data, createdAt: new Date(1_000 + transitions.length) });
        return {};
      },
      findMany: async (a: { where: { taskId: number; cause: { in: string[] } } }) =>
        transitions
          .filter((t) => t.taskId === a.where.taskId && a.where.cause.in.includes(t.cause))
          .reverse()
          .slice(0, 1),
      findFirst: async () => null,
    },
    task: {
      findUnique: async (a: { where: { id: number } }) => {
        const t = tasks.find((x) => x.id === a.where.id);
        if (!t) return null;
        return {
          id: t.id,
          description: t.description ?? null,
          workflowStatus: next(t.workflowStatus, statusReads, t.id),
        };
      },
      count: async () => 0,
      findMany: async (a: { where: Record<string, unknown>; select: Record<string, boolean> }) => {
        if (a.select.priority) {
          const skip = ((a.where.id as { notIn?: number[] } | undefined)?.notIn ?? []) as number[];
          return tasks
            .filter((t) => t.status === 'todo' && !skip.includes(t.id))
            .map((t, i) => ({
              id: t.id,
              status: t.status,
              workflowStatus: t.workflowStatus[0] ?? null,
              priority: 'medium',
              createdAt: new Date(1_000 + i),
              complexityScore: null,
            }));
        }
        const ids = (a.where.id as { in?: number[] } | undefined)?.in;
        return ids
          ? tasks.filter((t) => ids.includes(t.id)).map((t) => ({ id: t.id, status: t.status }))
          : [];
      },
    },
    gitHubPullRequest: { findMany: async () => [] },
  };
  return Object.assign(p, {
    readPlan: async (id: number) => (plans[id] ? next(plans[id]!, planReads, id) : null),
  }) as unknown as PrismaClient;
}

let client: PrismaClient;
const deps = () => ({
  readPlan: (client as unknown as { readPlan: (id: number) => Promise<string | null> }).readPlan,
  importRelated: async () => false,
  enqueue: async (item: { taskId: number }) => {
    enqueued.push(item.taskId);
  },
  now: () => 5_000,
});
const select = () => selectCompanionTask(client, 1, 'priority', deps());
const marks = () => transitions.filter((t) => t.cause === 'parallel_recheck_pending');

beforeEach(() => {
  enqueued.length = 0;
  casWrites.length = 0;
  transitions = [];
  createFails = false;
  casFails = false;
  dependencyLinked = false;
  rows = [runningRow({ themeId: 1, currentTaskId: 10 })];
  tasks = [
    { id: 10, status: 'in-progress', workflowStatus: ['in_progress'] },
    { id: 20, status: 'todo', workflowStatus: [null] },
  ];
  plans = { 10: [plan(HEAD_FILE)] };
  client = prisma();
});

describe('F1 — the mark follows the verdict taken at selection', () => {
  test('a plan saved and the status advanced after the filter still get a mark', async () => {
    tasks[1]!.workflowStatus = ['draft', 'plan_created'];
    plans[20] = [null, plan(HEAD_FILE)];
    expect(await select()).toEqual({ selected: 20 });
    expect(marks()).toHaveLength(1);
    expect(JSON.parse(marks()[0]!.metadata)).toMatchObject({ workflowStatus: 'draft' });
    expect(marks()[0]).toMatchObject({ taskId: 20 });
    expect(enqueued).toEqual([20]);
  });

  test('a candidate admitted with a plan gets no mark even if its plan later reads empty', async () => {
    tasks[1]!.workflowStatus = ['draft'];
    plans[20] = [plan('rapitas-frontend/src/beta/b.tsx'), null];
    expect(await select()).toEqual({ selected: 20 });
    expect(marks()).toEqual([]);
  });

  test('a refused planless candidate does not lend its verdict to the planned one chosen', async () => {
    tasks[1]!.description = 'タスク10に依存する'; // 20: planless but dependent → refused
    tasks.push({ id: 21, status: 'todo', workflowStatus: ['draft'] });
    plans[21] = [plan('rapitas-desktop/src/gamma/c.ts')];
    expect(await select()).toEqual({ selected: 21 });
    expect(marks()).toEqual([]);
  });

  test('a planless candidate chosen after a refused planned one gets the mark', async () => {
    tasks[1]!.workflowStatus = ['draft'];
    plans[20] = [plan(HEAD_FILE)]; // overlaps the head → refused
    tasks.push({ id: 21, status: 'todo', workflowStatus: ['research_done'] });
    expect(await select()).toEqual({ selected: 21 });
    expect(marks().map((m) => m.taskId)).toEqual([21]);
    expect(JSON.parse(marks()[0]!.metadata)).toMatchObject({ workflowStatus: 'research_done' });
  });
});

describe('T1 — failures around the real mark write', () => {
  test('the real writePendingMark rejecting takes no slot and enqueues nothing', async () => {
    createFails = true;
    expect(await select()).toEqual({ selected: null, reason: 'recheck_mark_failed' });
    expect(casWrites).toEqual([]);
    expect(enqueued).toEqual([]);
    expect(rows[0]!.companionTasksJson).toBeNull();
  });

  test('a mark written before a failed addCompanion holds the implementer (not_enrolled)', async () => {
    casFails = true;
    expect(await select()).toEqual({ selected: null, reason: 'companion_write_failed' });
    expect(marks()).toHaveLength(1);
    expect(enqueued).toEqual([]);
    const r = await guardParallelRecheck(
      20,
      { role: 'implementer', nextStatus: 'in_progress' } as never,
      { themeId: 1, theme: { workingDirectory: null } },
      'plan_approved' as never,
      'standard',
      { getPrisma: async () => client },
    );
    expect(r).toMatchObject({ done: true, result: { skipped: true } });
    const held = transitions.filter((t) => t.cause === 'parallel_recheck_held');
    expect(held).toHaveLength(1);
    expect(JSON.parse(held[0]!.metadata)).toMatchObject({ reason: 'not_enrolled' });
  });
});
