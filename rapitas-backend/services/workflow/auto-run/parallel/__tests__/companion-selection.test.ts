/**
 * companion-selection.test
 *
 * Task 1552 acceptance tables, per-theme limit 2 and global limit 2:
 *  1. only A runs, B does not overlap A → B becomes the 2nd task
 *  2. B shares one file with A → B is not selected, the reason is recorded
 *  3. C has no plan yet → C is not selected
 *  4. the global limit is already full → nothing is selected
 * plus the "do not run together" table (dependency link / text, conflict-prone
 * file, same folder, import relation), the same rules against a task running
 * in ANOTHER theme on the same repository (theme 49), and per-theme limit 1
 * (selection never runs — the pre-task one-at-a-time behaviour).
 * Row 5 (A completes) is in theme-active-set.test.ts and parallel-lifecycle.test.ts.
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
const { buildHeadParallelFilter } = await import('../head-parallel-filter');
const { parseCompanions } = await import('../companion-json');

interface TaskRow {
  id: number;
  themeId: number;
  status: string;
  description?: string;
}

let rows: FakeRow[];
let tasks: TaskRow[];
let plans: Record<number, string | null>;
let settings: Record<string, unknown>;
let queueCount: number;
let dependencyLinked: boolean;
let importRelated: boolean;
let themes: Array<{ id: number; workingDirectory: string | null }>;
const enqueued: number[] = [];

const plan = (...files: string[]) => files.map((f) => `- \`${f}\``).join('\n');

function prisma(): PrismaClient {
  const fake = fakeThemeAutoRun(rows);
  return {
    userSettings: { findFirst: async () => settings },
    themeAutoRun: fake.model,
    workflowQueueItem: { count: async () => queueCount, findMany: async () => [] },
    theme: {
      findUnique: async (a: { where: { id: number } }) =>
        themes.find((t) => t.id === a.where.id) ?? null,
      findMany: async () => themes,
    },
    taskDependency: { findFirst: async () => (dependencyLinked ? { id: 1 } : null) },
    agentExecution: { findMany: async () => [] },
    task: {
      findUnique: async (a: { where: { id: number } }) => {
        const t = tasks.find((x) => x.id === a.where.id);
        return t ? { id: t.id, description: t.description ?? null } : null;
      },
      count: async () => 0,
      findMany: async (a: { where: Record<string, unknown>; select: Record<string, boolean> }) => {
        // selectNextTask's candidate query is the one selecting `priority`.
        if (a.select.priority) {
          const skip = ((a.where.id as { notIn?: number[] } | undefined)?.notIn ?? []) as number[];
          return tasks
            .filter(
              (t) => t.themeId === a.where.themeId && t.status === 'todo' && !skip.includes(t.id),
            )
            .map((t, i) => ({
              id: t.id,
              status: t.status,
              workflowStatus: null,
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
});

beforeEach(() => {
  events.length = 0;
  enqueued.length = 0;
  settings = { autoRunMaxConcurrency: 2, autoRunMaxConcurrencyPerTheme: 2 };
  queueCount = 1;
  dependencyLinked = false;
  importRelated = false;
  themes = [{ id: 1, workingDirectory: 'C:/Projects/rapitas' }];
  rows = [runningRow({ themeId: 1, currentTaskId: 10 })];
  tasks = [
    { id: 10, themeId: 1, status: 'in-progress' },
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

describe('acceptance table — per-theme 2, global 2', () => {
  test('先頭完了後の次の選定でも繰り上げ済みBと重なる候補を拒否する', async () => {
    rows[0]!.companionTasksJson = '[{"taskId":20,"since":123}]';
    tasks[1]!.status = 'in-progress';
    tasks.push({ id: 30, themeId: 1, status: 'todo' });
    plans[30] = plans[20]!;
    const { releaseThemeSlot } = await import('../theme-active-set');
    await releaseThemeSlot(prisma(), 1, 10, 'completed');
    tasks[0]!.status = 'done';
    expect(await select()).toMatchObject({ selected: null, reason: 'parallel_conflict' });
    expect(rows[0]!.currentTaskId).toBe(20);
    expect(rows[0]!.lastRunAt).toEqual(new Date(123));
    expect(rejectedReasons()).toEqual(['file_overlap']);
  });
  test('投入が失敗したとき同伴だけを解放する', async () => {
    expect(
      await selectCompanionTask(prisma(), 1, 'priority', {
        ...deps(),
        enqueue: async () => {
          throw new Error('enqueue failed');
        },
      }),
    ).toEqual({ selected: null, reason: 'enqueue_failed' });
    expect(rows[0]).toMatchObject({
      currentTaskId: 10,
      companionTasksJson: null,
      processedCount: 0,
    });
  });
  test('選定中の停止では投入しない', async () => {
    const injected = deps();
    const readPlan = injected.readPlan;
    injected.readPlan = async (id) => {
      rows[0]!.status = 'stopping';
      return readPlan(id);
    };
    expect(await selectCompanionTask(prisma(), 1, 'priority', injected)).toMatchObject({
      selected: null,
    });
    expect(enqueued).toEqual([]);
  });
  test('投入直後の停止でも成功扱いせず、そのタスクを取り消す', async () => {
    const p = prisma();
    const cancelled: unknown[] = [];
    (
      p.workflowQueueItem as unknown as { updateMany: (args: unknown) => Promise<unknown> }
    ).updateMany = async (args) => {
      cancelled.push(args);
      return { count: 1 };
    };
    expect(
      await selectCompanionTask(p, 1, 'priority', {
        ...deps(),
        enqueue: async () => {
          rows[0]!.status = 'stopping';
          rows[0]!.companionTasksJson = null;
        },
      }),
    ).toMatchObject({ selected: null });
    expect(cancelled).toEqual([
      expect.objectContaining({ where: expect.objectContaining({ taskId: 20, themeId: 1 }) }),
    ]);
  });
  test('F3: 実行のない一時停止テーマは全体枠を占有しない', async () => {
    rows.push(runningRow({ themeId: 2, currentTaskId: 40, status: 'paused' }));
    tasks.push({ id: 40, themeId: 2, status: 'in-progress' });
    expect(await select()).toEqual({ selected: 20 });
  });
  test('row 1: only A runs and B does not overlap → B is selected as the 2nd task', async () => {
    expect(await select()).toEqual({ selected: 20 });
    expect(enqueued).toEqual([20]);
    expect(rows[0]!.currentTaskId).toBe(10); // A stays the head
    expect(parseCompanions(rows[0]!.companionTasksJson)).toEqual([{ taskId: 20, since: 5_000 }]);
  });

  test('row 2: B shares one file with A → not selected, reason and file recorded', async () => {
    plans[20] = plan('rapitas-backend/services/alpha/a.ts', 'rapitas-frontend/src/beta/b.tsx');
    const r = await select();
    expect(r).toMatchObject({ selected: null, reason: 'parallel_conflict' });
    expect(enqueued).toEqual([]);
    const rejected = events.find((e) => e.fields.cause === 'parallel_rejected');
    expect(rejected?.fields).toMatchObject({ task: 20, reason: 'file_overlap', role: 'companion' });
    expect(String(rejected?.fields.detail)).toContain('rapitas-backend/services/alpha/a.ts');
  });

  test('row 3: C has no plan yet → C is not selected', async () => {
    tasks = [tasks[0]!, { id: 30, themeId: 1, status: 'todo' }];
    expect(await select()).toMatchObject({ selected: null, reason: 'parallel_conflict' });
    expect(rejectedReasons()).toEqual(['candidate_plan_missing']);
    expect(rows[0]!.companionTasksJson).toBeNull();
  });

  test('row 4: the global limit is already full → nothing is selected', async () => {
    queueCount = 2;
    expect(await select()).toEqual({ selected: null, reason: 'concurrency_limit' });
    expect(enqueued).toEqual([]);
  });

  test('a passed-over candidate does not stop a later safe one', async () => {
    tasks.push({ id: 21, themeId: 1, status: 'todo' });
    plans[20] = plan('rapitas-backend/services/alpha/a.ts');
    plans[21] = plan('rapitas-desktop/src/gamma/c.ts');
    expect(await select()).toEqual({ selected: 21 });
    expect(rejectedReasons()).toEqual(['file_overlap']);
  });

  test('the theme is already full (2 running) → no third task', async () => {
    rows[0]!.companionTasksJson = '[{"taskId":20,"since":1}]';
    tasks.push({ id: 21, themeId: 1, status: 'todo' });
    expect(await select()).toEqual({ selected: null, reason: 'theme_full' });
  });
});

describe('per-theme limit 1 — the pre-task one-at-a-time behaviour', () => {
  test('selection does not run at all', async () => {
    settings = { autoRunMaxConcurrency: 2, autoRunMaxConcurrencyPerTheme: 1 };
    expect(await select()).toEqual({ selected: null, reason: 'per_theme_limit' });
    expect(enqueued).toEqual([]);
  });
  test('a missing column (client before regeneration) is limit 1', async () => {
    settings = { autoRunMaxConcurrency: 2 };
    expect(await select()).toEqual({ selected: null, reason: 'per_theme_limit' });
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
});

describe('another theme on the same repository (theme 49)', () => {
  beforeEach(() => {
    // Three heads run across the themes; leave room so only the pair rules decide.
    settings = { autoRunMaxConcurrency: 4, autoRunMaxConcurrencyPerTheme: 2 };
    queueCount = 3;
    themes = [
      { id: 1, workingDirectory: 'C:/Projects/rapitas' },
      { id: 49, workingDirectory: 'c:\\projects\\rapitas\\' }, // same repo, other spelling
      { id: 50, workingDirectory: 'C:/Projects/other-repo' },
    ];
    rows.push(runningRow({ themeId: 49, currentTaskId: 40 }));
    rows.push(runningRow({ themeId: 50, currentTaskId: 50 }));
    tasks.push(
      { id: 40, themeId: 49, status: 'in-progress' },
      { id: 50, themeId: 50, status: 'in-progress' },
    );
    plans[50] = plan('rapitas-frontend/src/beta/b.tsx'); // other repo: must be ignored
  });

  test('a companion candidate overlapping theme 49 running task is not selected', async () => {
    plans[40] = plan('rapitas-frontend/src/beta/b.tsx');
    expect(await select()).toMatchObject({ selected: null, reason: 'parallel_conflict' });
    const rejected = events.find((e) => e.fields.cause === 'parallel_rejected');
    expect(String(rejected?.fields.detail)).toContain('vs task 40');
  });

  test('theme 49 task without a plan does not block (fail-open for files)', async () => {
    plans[40] = null;
    expect(await select()).toEqual({ selected: 20 });
  });

  test('a dependency on theme 49 task blocks even without its plan', async () => {
    plans[40] = null;
    tasks[1]!.description = 'タスク40がマージされてから';
    expect(await select()).toMatchObject({ selected: null });
    expect(rejectedReasons()).toEqual(['dependency_text']);
  });

  test('head selection: the filter refuses a candidate overlapping theme 49 work', async () => {
    plans[40] = plan('rapitas-frontend/src/beta/b.tsx');
    const filter = await buildHeadParallelFilter(prisma(), 1, deps());
    expect(filter).toBeDefined();
    expect(await filter!({ id: 20, status: 'todo' })).toMatchObject({
      ok: false,
      reason: 'file_overlap',
    });
  });

  test('head selection: no other theme on the repository runs anything → no filter', async () => {
    rows.splice(1); // drop theme 49 and 50 rows
    expect(await buildHeadParallelFilter(prisma(), 1, deps())).toBeUndefined();
  });
});
