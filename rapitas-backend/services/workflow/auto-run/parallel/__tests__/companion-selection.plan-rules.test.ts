/**
 * companion-selection.plan-rules.test
 *
 * Plan-related companion selection rules, per-theme limit 2 and global limit 2:
 *  - task 1572: a candidate without a plan (workflowStatus null / draft /
 *    research_done) is selected when nothing links it to the running task, and
 *    carries a re-check mark written before its slot; any dependency (table,
 *    description, unfinished third task) still refuses it; `in_progress`
 *    without a plan stays refused (row 3 of task 1552 moved here).
 *  - task 1552's "do not run together" table (dependency, conflict-prone file,
 *    same folder, import relation) and the passed-over candidate.
 * Split out of companion-selection.test.ts for the file-size limit.
 *
 * Run on its own: bun's mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../../../../generated/prisma-postgres';
import { fakeThemeAutoRun, runningRow, type FakeRow } from './fake-theme-auto-run.test-support';

mock.module('../../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
const events: Array<{ evt: string; fields: Record<string, unknown> }> = [];
mock.module('../../../../observability', () => ({
  logCycleEvent: (evt: string, fields: Record<string, unknown>) => events.push({ evt, fields }),
}));
mock.module('../../../workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => ({ enqueue: async () => ({}) }) },
}));
mock.module('../../../../agents/stop-task-agents', () => ({
  stopTaskTreeAgents: async () => ({ executionIds: [] }),
}));

const { selectCompanionTask } = await import('../companion-selection');

interface TaskRow {
  id: number;
  themeId: number;
  status: string;
  workflowStatus?: string | null;
  description?: string;
}

let rows: FakeRow[];
let tasks: TaskRow[];
let plans: Record<number, string | null>;
let dependencyLinked: boolean;
let importRelated: boolean;
let markFails: boolean;
const enqueued: number[] = [];
const marks: Array<{ taskId: number; themeId: number; workflowStatus: string | null }> = [];
/** companionTasksJson at the moment each mark was written (order check). */
const slotAtMark: Array<string | null> = [];

const plan = (...files: string[]) => files.map((f) => `- \`${f}\``).join('\n');

function prisma(): PrismaClient {
  const fake = fakeThemeAutoRun(rows);
  return {
    userSettings: {
      findFirst: async () => ({ autoRunMaxConcurrency: 2, autoRunMaxConcurrencyPerTheme: 2 }),
    },
    themeAutoRun: fake.model,
    workflowQueueItem: { count: async () => 1, findMany: async () => [] },
    theme: {
      findUnique: async () => ({ id: 1, workingDirectory: 'C:/Projects/rapitas' }),
      findMany: async () => [{ id: 1, workingDirectory: 'C:/Projects/rapitas' }],
    },
    taskDependency: { findFirst: async () => (dependencyLinked ? { id: 1 } : null) },
    agentExecution: { findMany: async () => [] },
    task: {
      findUnique: async (a: { where: { id: number } }) => {
        const t = tasks.find((x) => x.id === a.where.id);
        return t
          ? {
              id: t.id,
              description: t.description ?? null,
              workflowStatus: t.workflowStatus ?? null,
            }
          : null;
      },
      count: async () => 0,
      findMany: async (a: { where: Record<string, unknown>; select: Record<string, boolean> }) => {
        if (a.select.priority) {
          const skip = ((a.where.id as { notIn?: number[] } | undefined)?.notIn ?? []) as number[];
          return tasks
            .filter(
              (t) => t.themeId === a.where.themeId && t.status === 'todo' && !skip.includes(t.id),
            )
            .map((t, i) => ({
              id: t.id,
              status: t.status,
              workflowStatus: t.workflowStatus ?? null,
              priority: 'medium',
              createdAt: new Date(1_000 + i),
              complexityScore: null,
            }));
        }
        const ids = (a.where.id as { in?: number[] } | undefined)?.in;
        if (ids)
          return tasks
            .filter((t) => ids.includes(t.id))
            .map((t) => ({ id: t.id, status: t.status }));
        return [];
      },
    },
    gitHubPullRequest: { findMany: async () => [] },
  } as unknown as PrismaClient;
}

const deps = () => ({
  readPlan: async (id: number) => plans[id] ?? null,
  importRelated: async () => importRelated,
  enqueue: async (item: { taskId: number }) => {
    enqueued.push(item.taskId);
  },
  now: () => 5_000,
  writeRecheckMark: async (input: {
    taskId: number;
    themeId: number;
    workflowStatus: string | null;
  }) => {
    slotAtMark.push(rows[0]!.companionTasksJson);
    if (markFails) throw new Error('db down');
    marks.push(input);
  },
});

beforeEach(() => {
  events.length = 0;
  enqueued.length = 0;
  marks.length = 0;
  slotAtMark.length = 0;
  dependencyLinked = false;
  importRelated = false;
  markFails = false;
  rows = [runningRow({ themeId: 1, currentTaskId: 10 })];
  tasks = [
    { id: 10, themeId: 1, status: 'in-progress', workflowStatus: 'in_progress' },
    { id: 20, themeId: 1, status: 'todo' },
  ];
  plans = {
    10: plan('rapitas-backend/services/alpha/a.ts'),
    20: plan('rapitas-frontend/src/beta/b.tsx'),
  };
});

const select = () => selectCompanionTask(prisma(), 1, 'priority', deps());
const rejectedReasons = () =>
  events.filter((e) => e.fields.cause === 'parallel_rejected').map((e) => e.fields.reason);

describe('task 1572 — a candidate without a plan', () => {
  for (const ws of [null, 'draft', 'research_done'] as const) {
    test(`workflowStatus ${ws} without a plan and no dependency → selected with a mark`, async () => {
      tasks = [tasks[0]!, { id: 30, themeId: 1, status: 'todo', workflowStatus: ws }];
      expect(await select()).toEqual({ selected: 30 });
      expect(rejectedReasons()).toEqual([]);
      expect(enqueued).toEqual([30]);
      expect(marks).toEqual([{ taskId: 30, themeId: 1, workflowStatus: ws }]);
      // The mark was written before the slot was taken.
      expect(slotAtMark).toEqual([null]);
    });
  }

  const deps3: Array<{ name: string; arrange: () => void; reason: string }> = [
    {
      name: 'dependency table link',
      arrange: () => (dependencyLinked = true),
      reason: 'dependency_link',
    },
    {
      name: 'dependency in the description',
      arrange: () => (tasks[1]!.description = 'タスク10に依存する'),
      reason: 'dependency_text',
    },
    {
      name: 'dependency on an unfinished third task',
      arrange: () => {
        tasks[1]!.description = '#77 の後に着手';
        tasks.push({ id: 77, themeId: 2, status: 'todo' });
      },
      reason: 'dependency_text',
    },
  ];
  for (const r of deps3) {
    test(`planless with a ${r.name} → not selected (${r.reason})`, async () => {
      plans[20] = null;
      tasks[1]!.workflowStatus = 'draft';
      r.arrange();
      expect(await select()).toMatchObject({ selected: null, reason: 'parallel_conflict' });
      expect(rejectedReasons()).toEqual([r.reason]);
      expect(marks).toEqual([]);
      expect(rows[0]!.companionTasksJson).toBeNull();
    });
  }

  test('row 3 (task 1552): in_progress without a plan stays refused', async () => {
    tasks = [tasks[0]!, { id: 30, themeId: 1, status: 'todo', workflowStatus: 'in_progress' }];
    expect(await select()).toMatchObject({ selected: null, reason: 'parallel_conflict' });
    expect(rejectedReasons()).toEqual(['candidate_plan_missing']);
    expect(rows[0]!.companionTasksJson).toBeNull();
  });

  test('a failed mark write takes no slot and enqueues nothing', async () => {
    plans[20] = null;
    markFails = true;
    expect(await select()).toEqual({ selected: null, reason: 'recheck_mark_failed' });
    expect(rows[0]!.companionTasksJson).toBeNull();
    expect(enqueued).toEqual([]);
  });

  test('a candidate with a plan gets no mark', async () => {
    expect(await select()).toEqual({ selected: 20 });
    expect(slotAtMark).toEqual([]);
  });
});

describe('pairs that must not run together (same theme)', () => {
  const rows2: Array<{ name: string; arrange: () => void; reason: string }> = [
    {
      name: 'dependency table link',
      arrange: () => (dependencyLinked = true),
      reason: 'dependency_link',
    },
    {
      name: 'dependency written in the description',
      arrange: () => (tasks[1]!.description = 'タスク10に依存する'),
      reason: 'dependency_text',
    },
    {
      name: 'dependency on an unfinished third task',
      arrange: () => {
        tasks[1]!.description = '#77 の後に着手';
        tasks.push({ id: 77, themeId: 2, status: 'todo' });
      },
      reason: 'dependency_text',
    },
    // NOTE: since 2026-11-27 a pair-scoped kind refuses only when both the
    // running task and the candidate touch it, so both sides are arranged here.
    {
      name: 'both touch messages (pair-scoped kind)',
      arrange: () => {
        plans[10] = plan('rapitas-frontend/messages/en.json');
        plans[20] = plan('rapitas-frontend/messages/ja.json');
      },
      reason: 'conflict_prone_file',
    },
    {
      name: 'both touch the prisma schema (pair-scoped kind)',
      arrange: () => {
        plans[10] = plan('rapitas-backend/prisma/schema/core.prisma');
        plans[20] = plan('rapitas-backend/prisma/schema/system.prisma');
      },
      reason: 'conflict_prone_file',
    },
    {
      name: 'a lockfile on the candidate (any-scoped kind)',
      arrange: () => (plans[20] = plan('pnpm-lock.yaml')),
      reason: 'conflict_prone_file',
    },
    {
      name: 'same folder',
      arrange: () => (plans[20] = plan('rapitas-backend/services/alpha/other.ts')),
      reason: 'same_directory',
    },
    { name: 'import relation', arrange: () => (importRelated = true), reason: 'import_relation' },
  ];
  for (const r of rows2) {
    test(`${r.name} → not selected (${r.reason})`, async () => {
      r.arrange();
      expect(await select()).toMatchObject({ selected: null, reason: 'parallel_conflict' });
      expect(rejectedReasons()).toEqual([r.reason]);
      expect(enqueued).toEqual([]);
    });
  }

  // 2026-11-27 user request: a schema task next to one that does not touch the schema.
  test('a schema task next to a task that does not touch the schema is selected', async () => {
    plans[20] = plan('rapitas-backend/prisma/schema/core.prisma');
    expect(await select()).toEqual({ selected: 20 });
    expect(rejectedReasons()).toEqual([]);
  });

  test('a passed-over candidate does not stop a later safe one', async () => {
    tasks.push({ id: 21, themeId: 1, status: 'todo' });
    plans[20] = plan('rapitas-backend/services/alpha/a.ts');
    plans[21] = plan('rapitas-desktop/src/gamma/c.ts');
    expect(await select()).toEqual({ selected: 21 });
    expect(rejectedReasons()).toEqual(['file_overlap']);
  });
});
