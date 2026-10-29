/**
 * roadmap-commit.test
 *
 * The half that writes.
 *
 * It takes the plan the user approved and nothing else — no model runs here,
 * so what gets created is exactly what was on screen. That is the whole
 * safety argument for letting a model draft the plan in the first place, and
 * these tests are mostly about holding it: the ids come from the payload,
 * creation stops at the first failure rather than leaving half a roadmap,
 * and a theme is only made when the plan said to make one.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { join } from 'node:path';

/** Everything the stand-in database was asked to create, in order. */
let created: { model: string; data: Record<string, unknown> }[] = [];
let nextId = 100;
let failOnTaskNumber: number | null = null;
let taskCount = 0;

mock.module('../../config/database', () => ({
  prisma: {
    theme: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push({ model: 'theme', data });
        return { id: nextId++, ...data };
      },
    },
    project: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push({ model: 'project', data });
        return { id: nextId++, ...data };
      },
    },
  },
  ensureDatabaseConnection: async () => {},
}));

mock.module('../task/task-mutations', () => ({
  createTask: async (_p: unknown, input: Record<string, unknown>) => {
    taskCount += 1;
    if (failOnTaskNumber === taskCount) throw new Error('db went away');
    created.push({ model: 'task', data: input });
    return { id: nextId++, ...input };
  },
}));

const { commitRoadmap } = await import('./roadmap-commit');

const PLAN = {
  goal: '英語のリスニングを続ける',
  themeChoice: { kind: 'new' as const, name: '英語学習', reason: '既存に無い' },
  projectChoice: { kind: 'existing' as const, id: 7, name: '自己開発' },
  steps: [
    { title: '教材を1つ選ぶ', description: 'エピソード30本以上' },
    { title: '時間帯を決める', description: '毎日取れる枠を1つ' },
  ],
};

const made = (model: string) => created.filter((c) => c.model === model);

beforeEach(() => {
  created = [];
  nextId = 100;
  taskCount = 0;
  failOnTaskNumber = null;
});

describe('creating what was approved', () => {
  test('makes the theme the plan asked to make', async () => {
    await commitRoadmap(PLAN);
    expect(made('theme')).toHaveLength(1);
    expect(made('theme')[0].data.name).toBe('英語学習');
  });

  // Reusing is the point of showing the existing ones in the draft.
  test('makes no theme when the plan picked an existing one', async () => {
    await commitRoadmap({ ...PLAN, themeChoice: { kind: 'existing', id: 1, name: 'rapitas' } });
    expect(made('theme')).toEqual([]);
    expect(made('task')[0].data.themeId).toBe(1);
  });

  test('makes no project when the plan said none was needed', async () => {
    await commitRoadmap({ ...PLAN, projectChoice: { kind: 'none', reason: '小さい' } });
    expect(made('project')).toEqual([]);
    expect(made('task')[0].data.projectId).toBeUndefined();
  });

  test('files one task per step, in order', async () => {
    await commitRoadmap(PLAN);
    expect(made('task').map((t) => t.data.title)).toEqual(['教材を1つ選ぶ', '時間帯を決める']);
  });

  // The description is what the request asked to be quantitative; dropping
  // it would leave a title with no definition of done.
  test('carries each step description into the task', async () => {
    await commitRoadmap(PLAN);
    expect(made('task')[0].data.description).toBe('エピソード30本以上');
  });

  test('puts every task in the theme it just made', async () => {
    const out = await commitRoadmap(PLAN);
    const themeId = out.themeId;
    expect(themeId).toBeGreaterThan(0);
    expect(made('task').every((t) => t.data.themeId === themeId)).toBe(true);
  });

  test('reports what it created, so the caller can link to it', async () => {
    const out = await commitRoadmap(PLAN);
    expect(out.taskIds).toHaveLength(2);
    expect(out.themeId).toBeGreaterThan(0);
    expect(out.projectId).toBe(7);
  });
});

describe('the dates the plan carried', () => {
  test('reach the task, so a deadline is more than a sentence', async () => {
    await commitRoadmap({
      ...PLAN,
      steps: [{ title: '一歩目', description: 'やる', dueDate: '2026-11-20' }],
    });
    expect(made('task')[0]?.data.dueDate).toBe('2026-11-20');
  });

  test('are left off entirely when the plan had none', async () => {
    await commitRoadmap(PLAN);
    // Not null: an explicit null would clear a date, and there is nothing
    // here to clear. The field should simply not be in the write.
    expect(made('task')[0]?.data).not.toHaveProperty('dueDate');
  });
});

describe('when something goes wrong partway', () => {
  // Half a roadmap is worse than none: the user cannot tell which steps are
  // missing without reading the plan against the backlog.
  test('reports what it managed before it stopped', async () => {
    failOnTaskNumber = 2;
    const out = await commitRoadmap(PLAN);
    expect(out.taskIds).toHaveLength(1);
    expect(out.failedAfter).toBe(1);
  });

  test('does not pretend the rest succeeded', async () => {
    failOnTaskNumber = 1;
    const out = await commitRoadmap(PLAN);
    expect(out.taskIds).toEqual([]);
    expect(out.failedAfter).toBe(0);
  });

  test('says nothing failed when nothing did', async () => {
    const out = await commitRoadmap(PLAN);
    expect(out.failedAfter).toBeNull();
  });
});

describe('what it refuses', () => {
  test('creates nothing for a plan with no steps', async () => {
    const out = await commitRoadmap({ ...PLAN, steps: [] });
    expect(created).toEqual([]);
    expect(out.taskIds).toEqual([]);
  });

  // No model runs here. What is created is what the user saw and approved,
  // which is the reason a model was allowed to draft it.
  test('consults no model', async () => {
    // `import.meta.dir` rather than a file URL: the pathname carries a
    // leading slash before a Windows drive letter, and stripping it turns
    // every POSIX path relative — green here, ENOENT in CI.
    const source = await Bun.file(join(import.meta.dir, 'roadmap-commit.ts')).text();
    expect(source).not.toContain('sendAIMessage');
  });
});
