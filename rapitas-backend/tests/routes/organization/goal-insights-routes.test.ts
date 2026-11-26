/**
 * goal-insights-routes.test
 *
 * GET /goal-insights: read-only metrics. With no material every rate is null
 * (never 0), a bad period is refused, and recorded reopens reach the quality metric.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  project: {
    findMany: mock(() => Promise.resolve([] as unknown[])),
    findUnique: mock(() => Promise.resolve(null as unknown)),
  },
  timelineEvent: { findMany: mock(() => Promise.resolve([] as unknown[])) },
};

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

const { default: insightsRoutes } =
  await import('../../../routes/organization/goal-insights.routes');
const { errorHandler } = await import('../../../middleware/error-handler');
const { default: goalsRoutes } = await import('../../../routes/organization/goals.routes');
const app = new Elysia().use(errorHandler).use(insightsRoutes).use(goalsRoutes);
const get = (path: string) => app.handle(new Request(`http://localhost${path}`));

beforeEach(() => {
  mockPrisma.project.findMany.mockReset().mockResolvedValue([]);
  mockPrisma.project.findUnique.mockReset().mockResolvedValue(null);
  mockPrisma.timelineEvent.findMany.mockReset().mockResolvedValue([]);
});

describe('GET /goal-insights', () => {
  test('ゴール詳細と指標を併設しても各ルートの応答が混ざらない', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({
      id: 7,
      name: '資格',
      description: null,
      color: '#000000',
      icon: null,
      milestones: [],
      tasks: [],
      _count: { tasks: 0 },
    });
    const detail = await get('/goals/7');
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id: 7, name: '資格', milestones: [] });
    const insights = await get('/goal-insights?period=all');
    expect(insights.status).toBe(200);
    expect(await insights.json()).toMatchObject({ period: 'all', goals: [] });
    expect(mockPrisma.project.findUnique).toHaveBeenCalledTimes(1);
    expect(mockPrisma.project.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 } }),
    );
  });

  test('with no material every rate is null and the period defaults to 4w', async () => {
    const res = await get('/goal-insights');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.period).toBe('4w');
    expect(body.goals).toEqual([]);
    for (const k of ['reachRate', 'resumeRate', 'quality', 'feltProgress']) {
      expect(body.overall[k].rate).toBeNull();
    }
    expect(body.overall.feltProgress.reason).toBe('no-reflection-source');
  });

  test('refuses an unknown period', async () => {
    const res = await get('/goal-insights?period=1y');
    expect(res.status).toBe(400);
  });

  test('lists each goal and counts a recorded reopen against quality', async () => {
    const t = (iso: string) => new Date(iso);
    mockPrisma.project.findMany.mockResolvedValue([
      {
        id: 1,
        name: '資格',
        createdAt: t('2026-11-20T00:00:00Z'),
        milestones: [
          {
            id: 10,
            status: 'reached',
            dueDate: null,
            reachedAt: t('2026-11-24T00:00:00Z'),
            updatedAt: t('2026-11-24T00:00:00Z'),
          },
          {
            id: 11,
            status: 'open',
            dueDate: null,
            reachedAt: null,
            updatedAt: t('2026-11-24T00:00:00Z'),
          },
        ],
        tasks: [{ status: 'todo', updatedAt: t('2026-11-24T00:00:00Z'), completedAt: null }],
      },
    ]);
    mockPrisma.timelineEvent.findMany.mockResolvedValue([
      { payload: JSON.stringify({ milestoneId: 11, reachedAt: '2026-11-22T00:00:00.000Z' }) },
      { payload: 'not json' },
    ]);
    const body = await (await get('/goal-insights?period=all')).json();
    expect(body.goals).toHaveLength(1);
    expect(body.goals[0]).toMatchObject({ id: 1, name: '資格', reached: 1, open: 1, paused: 0 });
    expect(body.overall.quality).toMatchObject({ numerator: 1, denominator: 2, rate: 0.5 });
  });
});

describe('GET /goal-insights — several goals and periods', () => {
  const at = (iso: string) => new Date(iso);
  const rows = () => [
    {
      id: 1,
      name: '古いゴール',
      createdAt: at('2026-09-01T00:00:00Z'),
      milestones: [
        {
          id: 1,
          status: 'reached',
          dueDate: null,
          reachedAt: at('2026-09-10T00:00:00Z'),
          updatedAt: at('2026-09-10T00:00:00Z'),
        },
        {
          id: 2,
          status: 'open',
          dueDate: null,
          reachedAt: null,
          updatedAt: at('2026-09-10T00:00:00Z'),
        },
      ],
      tasks: [],
    },
    {
      id: 2,
      name: '最近のゴール',
      createdAt: at('2026-11-20T00:00:00Z'),
      milestones: [
        {
          id: 3,
          status: 'open',
          dueDate: null,
          reachedAt: null,
          updatedAt: at('2099-01-01T00:00:00Z'),
        },
      ],
      tasks: [],
    },
  ];

  test('returns every goal with the stalled one first; the period changes the metrics only', async () => {
    mockPrisma.project.findMany.mockResolvedValue(rows());
    mockPrisma.timelineEvent.findMany.mockResolvedValue([
      { payload: JSON.stringify({ milestoneId: 1, reachedAt: '2026-09-10T00:00:00.000Z' }) },
    ]);
    const all = await (await get('/goal-insights?period=all')).json();
    const four = await (await get('/goal-insights?period=4w')).json();
    expect(all.goals.map((g: { id: number }) => g.id)).toEqual([1, 2]);
    expect(all.goals[0].stalled).toBe(true);
    expect(four.goals).toEqual(all.goals);
    expect(all.overall.quality).toMatchObject({ numerator: 0, denominator: 1, rate: 0 });
    expect(four.overall.quality).toMatchObject({ numerator: 0, denominator: 0, rate: null });
  });
});
