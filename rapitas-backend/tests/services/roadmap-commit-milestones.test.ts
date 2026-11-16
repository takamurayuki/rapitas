/**
 * roadmap-commit-milestones.test
 *
 * Committing an approved roadmap with milestones (節目): they are created
 * under the goal's project in plan order, after any it already has, with the
 * approved criteria; each task is filed under its milestone. With no project
 * there is nowhere to put a milestone, so none are made.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

let created: { model: string; data: Record<string, unknown> }[] = [];
let nextId = 100;
let lastSortOrder: number | null = null;

mock.module('../../config/database', () => ({
  prisma: {
    theme: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push({ model: 'theme', data });
        return { id: nextId++ };
      },
    },
    project: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push({ model: 'project', data });
        return { id: nextId++ };
      },
    },
    milestone: {
      findFirst: async () => (lastSortOrder === null ? null : { sortOrder: lastSortOrder }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push({ model: 'milestone', data });
        return { id: nextId++ };
      },
    },
  },
  ensureDatabaseConnection: async () => {},
}));

mock.module('../../services/task/task-mutations', () => ({
  createTask: async (_p: unknown, input: Record<string, unknown>) => {
    created.push({ model: 'task', data: input });
    return { id: nextId++ };
  },
}));

const { commitRoadmap } = await import('../../services/assistant/roadmap-commit');

const step = (title: string, milestoneIndex?: number) => ({
  title,
  description: title,
  acceptanceCriteria: [`${title}が終わっている`],
  ...(milestoneIndex !== undefined ? { milestoneIndex } : {}),
});

const PLAN = {
  goal: '基本情報に合格する',
  themeChoice: { kind: 'none' as const },
  projectChoice: { kind: 'existing' as const, id: 7 },
  milestones: [
    { name: '基礎固め', acceptanceCriteria: ['午前の過去問で7割'], dueDate: '2026-12-01' },
    { name: '仕上げ', acceptanceCriteria: ['模試で合格点'] },
  ],
  steps: [step('テキスト', 0), step('過去問', 0), step('模試', 1), step('申し込み')],
};

beforeEach(() => {
  created = [];
  nextId = 100;
  lastSortOrder = null;
});

describe('commitRoadmap — milestones', () => {
  test('creates the milestones under the project with their criteria, then files tasks under them', async () => {
    const result = await commitRoadmap(PLAN);
    const milestones = created.filter((c) => c.model === 'milestone').map((c) => c.data);
    expect(milestones).toEqual([
      {
        projectId: 7,
        name: '基礎固め',
        acceptanceCriteria: JSON.stringify(['午前の過去問で7割']),
        dueDate: new Date('2026-12-01'),
        sortOrder: 0,
      },
      {
        projectId: 7,
        name: '仕上げ',
        acceptanceCriteria: JSON.stringify(['模試で合格点']),
        sortOrder: 1,
      },
    ]);
    const tasks = created.filter((c) => c.model === 'task').map((c) => c.data);
    expect(tasks.map((t) => t.milestoneId)).toEqual([100, 100, 101, undefined]);
    expect(result.milestoneIds).toEqual([100, 101]);
    // Milestones are created before any task, so a task never points at a missing one.
    expect(created.findIndex((c) => c.model === 'task')).toBeGreaterThan(
      created.findLastIndex((c) => c.model === 'milestone'),
    );
  });

  test('appends after the milestones the project already has', async () => {
    lastSortOrder = 4;
    await commitRoadmap(PLAN);
    const orders = created.filter((c) => c.model === 'milestone').map((c) => c.data.sortOrder);
    expect(orders).toEqual([5, 6]);
  });

  test('creates no milestones when the plan has no project', async () => {
    const result = await commitRoadmap({ ...PLAN, projectChoice: { kind: 'none' } });
    expect(created.some((c) => c.model === 'milestone')).toBe(false);
    expect(
      created.filter((c) => c.model === 'task').every((c) => c.data.milestoneId === undefined),
    ).toBe(true);
    expect(result.milestoneIds).toEqual([]);
  });

  test('a plan without milestones commits exactly as before', async () => {
    const { milestones: _m, ...flat } = PLAN;
    const result = await commitRoadmap({ ...flat, steps: [step('a'), step('b')] });
    expect(created.some((c) => c.model === 'milestone')).toBe(false);
    expect(result.taskIds).toHaveLength(2);
  });
});
