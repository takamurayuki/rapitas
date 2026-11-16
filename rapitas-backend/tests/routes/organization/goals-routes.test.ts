/**
 * goals-routes.test
 *
 * A goal is a project seen from the person's side: its milestones in order,
 * how many of each milestone's tasks are done, and the reach rate — counted
 * only from confirmed milestones, never from task completion.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  project: {
    findMany: mock(() => Promise.resolve([] as unknown[])),
    findUnique: mock(() => Promise.resolve(null as unknown)),
  },
};

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

const { default: goalsRoutes } = await import('../../../routes/organization/goals.routes');
const { errorHandler } = await import('../../../middleware/error-handler');

const app = new Elysia().use(errorHandler).use(goalsRoutes);
const get = (path: string) => app.handle(new Request(`http://localhost${path}`));

const milestone = (id: number, status: string, taskStatuses: string[], extra = {}) => ({
  id,
  name: `節目${id}`,
  description: null,
  dueDate: null,
  status,
  acceptanceCriteria: JSON.stringify([`条件${id}`]),
  evidence: status === 'reached' ? '根拠' : null,
  reachedAt: status === 'reached' ? new Date('2026-11-01T00:00:00Z') : null,
  sortOrder: id,
  tasks: taskStatuses.map((s) => ({ status: s })),
  ...extra,
});

beforeEach(() => {
  mockPrisma.project.findMany.mockReset();
  mockPrisma.project.findUnique.mockReset();
});

describe('GET /goals', () => {
  test('lists each goal with its reach rate and next open milestone', async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      {
        id: 1,
        name: '資格に合格する',
        description: '基本情報に合格',
        color: '#3B82F6',
        icon: null,
        _count: { tasks: 5 },
        milestones: [milestone(1, 'reached', ['done']), milestone(2, 'open', ['todo'])],
      },
    ]);
    const res = await get('/goals');
    expect(res.status).toBe(200);
    const [goal] = await res.json();
    expect(goal.progress).toEqual({ total: 2, reached: 1, paused: 0, open: 1, reachRate: 0.5 });
    expect(goal.nextMilestone).toMatchObject({ id: 2, name: '節目2' });
    expect(goal.taskCount).toBe(5);
  });
});

describe('GET /goals/:id', () => {
  test('returns milestones with parsed criteria and task counts', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({
      id: 1,
      name: '資格に合格する',
      description: null,
      color: '#3B82F6',
      icon: null,
      milestones: [milestone(1, 'open', ['done', 'done', 'todo'])],
      _count: { tasks: 4 },
      tasks: [{ id: 9 }],
    });
    const res = await get('/goals/1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.milestones[0]).toMatchObject({
      id: 1,
      acceptanceCriteria: ['条件1'],
      taskTotal: 3,
      taskDone: 2,
    });
    // All of a milestone's tasks done does not make it reached.
    expect(body.progress.reached).toBe(0);
    expect(body.unassignedTaskCount).toBe(1);
  });

  test('404 for an unknown goal', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);
    expect((await get('/goals/99')).status).toBe(404);
  });

  test('400 for a malformed id', async () => {
    expect((await get('/goals/abc')).status).toBe(400);
  });
});
