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
  timelineEvent: {
    create: mock((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 9, ...args.data }),
    ),
  },
  $transaction: mock((ops: Promise<unknown>[]) => Promise.all(ops)),
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
  mockPrisma.timelineEvent.create.mockClear();
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

  test('records the cancellation with the milestone id and the prior reach time', async () => {
    const reachedAt = new Date('2026-11-01T00:00:00Z');
    mockPrisma.milestone.findUnique.mockResolvedValue(stored({ status: 'reached', reachedAt }));
    await json('POST', '/milestones/1/reopen');
    expect(mockPrisma.timelineEvent.create).toHaveBeenCalledTimes(1);
    const data = mockPrisma.timelineEvent.create.mock.calls[0][0].data;
    expect(data.eventType).toBe('milestone_reopened');
    expect(JSON.parse(data.payload as string)).toEqual({
      milestoneId: 1,
      reachedAt: reachedAt.toISOString(),
    });
  });

  test('fails the request when the record cannot be written', async () => {
    mockPrisma.milestone.findUnique.mockResolvedValue(stored({ status: 'reached' }));
    mockPrisma.$transaction.mockRejectedValueOnce(new Error('write failed'));
    const res = await json('POST', '/milestones/1/reopen');
    expect(res.status).toBe(500);
  });

  test('records nothing when the milestone was not reached', async () => {
    mockPrisma.milestone.findUnique.mockResolvedValue(stored({ status: 'open' }));
    await json('POST', '/milestones/1/reopen');
    expect(mockPrisma.timelineEvent.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /milestones/:id — undoing a reach through status', () => {
  test('reached → open is recorded like a reopen', async () => {
    const reachedAt = new Date('2026-11-02T00:00:00Z');
    mockPrisma.milestone.findUnique.mockResolvedValue(stored({ status: 'reached', reachedAt }));
    const res = await json('PATCH', '/milestones/1', { status: 'open' });
    expect(res.status).toBe(200);
    const data = mockPrisma.timelineEvent.create.mock.calls[0][0].data;
    expect(data.eventType).toBe('milestone_reopened');
    expect(JSON.parse(data.payload as string).reachedAt).toBe(reachedAt.toISOString());
  });

  test('open → open and open → paused record nothing', async () => {
    mockPrisma.milestone.findUnique.mockResolvedValue(stored({ status: 'open' }));
    await json('PATCH', '/milestones/1', { status: 'open' });
    await json('PATCH', '/milestones/1', { status: 'paused' });
    expect(mockPrisma.timelineEvent.create).not.toHaveBeenCalled();
  });
});

describe('atomicity of the undo and its record (lazy ops, snapshot rollback)', () => {
  // Real Prisma operations are lazy: nothing is written until awaited or handed to
  // $transaction. These fakes behave the same way and roll the store back on failure.
  const store = { status: 'reached', events: 0 };
  const lazy = <T>(run: () => T): PromiseLike<T> => ({
    then: (ok, fail) => Promise.resolve().then(run).then(ok, fail),
  });

  beforeEach(() => {
    store.status = 'reached';
    store.events = 0;
    mockPrisma.milestone.update.mockImplementation(((args: { data: Record<string, unknown> }) =>
      lazy(() => {
        store.status = String(args.data.status);
        return { id: 1, status: store.status, acceptanceCriteria: null };
      })) as never);
    mockPrisma.timelineEvent.create.mockImplementation((() =>
      lazy(() => {
        store.events++;
        return { id: 9 };
      })) as never);
    mockPrisma.$transaction.mockImplementation((async (ops: PromiseLike<unknown>[]) => {
      const snapshot = { ...store };
      try {
        const out: unknown[] = [];
        for (const op of ops) out.push(await op);
        return out;
      } catch (err) {
        Object.assign(store, snapshot);
        throw err;
      }
    }) as never);
    mockPrisma.milestone.findUnique.mockResolvedValue(stored({ status: 'reached' }));
  });

  test.each([
    ['POST /reopen', 'POST', '/milestones/1/reopen', undefined],
    ['PATCH status:open', 'PATCH', '/milestones/1', { status: 'open' }],
  ])('%s: update and record are applied together', async (_n, method, path, body) => {
    const res = await json(method, path, body);
    expect(res.status).toBe(200);
    expect(store).toEqual({ status: 'open', events: 1 });
  });

  test.each([
    ['POST /reopen', 'POST', '/milestones/1/reopen', undefined],
    ['PATCH status:open', 'PATCH', '/milestones/1', { status: 'open' }],
  ])('%s: a failed record leaves the milestone reached', async (_n, method, path, body) => {
    mockPrisma.timelineEvent.create.mockImplementation((() =>
      lazy(() => {
        throw new Error('write failed');
      })) as never);
    const res = await json(method, path, body);
    expect(res.status).toBe(500);
    expect(store).toEqual({ status: 'reached', events: 0 });
  });
});
