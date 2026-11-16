/**
 * milestone-achievement-routes.test
 *
 * Milestone criteria are edited through PATCH, but `reached` can only be
 * reached through POST /milestones/:id/confirm — with every criterion ticked
 * and the evidence written — and undone through POST /milestones/:id/reopen.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  milestone: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null as unknown)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 1, status: 'open', acceptanceCriteria: null, ...args.data }),
    ),
    delete: mock(() => Promise.resolve({})),
  },
};

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

const { milestonesRoutes } = await import('../../../routes/organization/milestones');
const { default: achievementRoutes } =
  await import('../../../routes/organization/milestone-achievement.routes');
const { errorHandler } = await import('../../../middleware/error-handler');

const app = new Elysia().use(errorHandler).use(milestonesRoutes).use(achievementRoutes);

const json = (method: string, path: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const CRITERIA = ['模試で7割', '過去問3年分'];
const stored = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: '基礎固め',
  status: 'open',
  acceptanceCriteria: JSON.stringify(CRITERIA),
  evidence: null,
  reachedAt: null,
  ...over,
});

beforeEach(() => {
  mockPrisma.milestone.findUnique.mockReset();
  mockPrisma.milestone.update.mockClear();
});

describe('PATCH /milestones/:id — criteria and status', () => {
  test('stores the criteria as a cleaned JSON array and returns them as a list', async () => {
    mockPrisma.milestone.findUnique.mockResolvedValue(stored({ acceptanceCriteria: null }));
    const res = await json('PATCH', '/milestones/1', {
      acceptanceCriteria: [' 模試で7割 ', '', '模試で7割', '過去問3年分'],
    });
    expect(res.status).toBe(200);
    const data = mockPrisma.milestone.update.mock.calls[0][0].data;
    expect(data.acceptanceCriteria).toBe(JSON.stringify(CRITERIA));
    expect((await res.json()).acceptanceCriteria).toEqual(CRITERIA);
  });

  test('can pause and resume, but cannot set reached directly', async () => {
    mockPrisma.milestone.findUnique.mockResolvedValue(stored());
    expect((await json('PATCH', '/milestones/1', { status: 'paused' })).status).toBe(200);
    expect(mockPrisma.milestone.update.mock.calls[0][0].data.status).toBe('paused');

    const res = await json('PATCH', '/milestones/1', { status: 'reached' });
    expect(res.status).toBe(400);
  });

  test('refuses to change the criteria of a reached milestone (reopen first)', async () => {
    mockPrisma.milestone.findUnique.mockResolvedValue(stored({ status: 'reached' }));
    const res = await json('PATCH', '/milestones/1', { acceptanceCriteria: ['別の条件'] });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('milestone_reached_locked');
    expect(mockPrisma.milestone.update).not.toHaveBeenCalled();
  });
});

describe('POST /milestones/:id/confirm', () => {
  test('marks the milestone reached with the evidence when every criterion is checked', async () => {
    mockPrisma.milestone.findUnique.mockResolvedValue(stored());
    const res = await json('POST', '/milestones/1/confirm', {
      checkedCriteria: CRITERIA,
      evidence: ' 11/10 の模試で 74% ',
    });
    expect(res.status).toBe(200);
    const data = mockPrisma.milestone.update.mock.calls[0][0].data;
    expect(data.status).toBe('reached');
    expect(data.evidence).toBe('11/10 の模試で 74%');
    expect(data.reachedAt).toBeInstanceOf(Date);
  });

  test('refuses with the reason when a criterion is left unchecked', async () => {
    mockPrisma.milestone.findUnique.mockResolvedValue(stored());
    const res = await json('POST', '/milestones/1/confirm', {
      checkedCriteria: ['模試で7割'],
      evidence: '途中',
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('milestone_criteria_unchecked');
    expect(mockPrisma.milestone.update).not.toHaveBeenCalled();
  });

  test('404 for a milestone that does not exist', async () => {
    mockPrisma.milestone.findUnique.mockResolvedValue(null);
    const res = await json('POST', '/milestones/9/confirm', { checkedCriteria: [], evidence: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('POST /milestones/:id/reopen', () => {
  test('returns a reached milestone to open and clears its confirmation', async () => {
    mockPrisma.milestone.findUnique.mockResolvedValue(
      stored({ status: 'reached', evidence: 'x', reachedAt: new Date() }),
    );
    const res = await json('POST', '/milestones/1/reopen');
    expect(res.status).toBe(200);
    expect(mockPrisma.milestone.update.mock.calls[0][0].data).toEqual({
      status: 'open',
      evidence: null,
      reachedAt: null,
    });
  });
});
