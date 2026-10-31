/**
 * hypothesis-service.ledger-scope.test
 *
 * What this encodes (#1321, measured 2026-10-31): the ledger holds 2,100
 * hypotheses — pending 226, validated 1,509, rejected 358, conflict 7 — but
 * only 44 of them sit in `forgettingStage: 'active'`, and NONE of the 1,509
 * validated ones do, because graduation is followed by consolidation out of
 * `active`. Both the stats and the list filtered on that stage, so the ledger
 * reported `supported: 0` while 1,509 supported hypotheses existed, and a
 * reader (this author included) concluded the loop had never confirmed
 * anything.
 *
 * Own file — mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));

type Where = Record<string, unknown>;

const countWheres: Where[] = [];
const findManyWheres: Where[] = [];

const prisma = {
  knowledgeEntry: {
    count: mock(async ({ where }: { where: Where }) => {
      countWheres.push(where);
      return 0;
    }),
    findMany: mock(async ({ where }: { where: Where }) => {
      findManyWheres.push(where);
      return [];
    }),
    findFirst: mock(async () => null),
  },
};
mock.module('../../config/database', () => ({
  prisma,
  ensureDatabaseConnection: mock(async () => {}),
}));

const { getHypothesisStats, listHypotheses } = await import('./hypothesis-service');

beforeEach(() => {
  countWheres.length = 0;
  findManyWheres.length = 0;
});

describe('getHypothesisStats', () => {
  test('counts the whole ledger, not only what is still active', async () => {
    await getHypothesisStats();

    expect(countWheres).toHaveLength(4);
    for (const where of countWheres) {
      // The bug: `forgettingStage: 'active'` here dropped every validated
      // hypothesis, so supported could only ever be reported as 0.
      expect(where.forgettingStage).toBeUndefined();
      expect(where.sourceType).toBe('hypothesis');
    }
  });

  test('still counts each status separately', async () => {
    await getHypothesisStats();
    expect(countWheres.map((w) => w.validationStatus)).toEqual([
      'pending',
      'validated',
      'rejected',
      'conflict',
    ]);
  });
});

describe('listHypotheses', () => {
  test('keeps the active-only working view by default', async () => {
    // The list is a working view, so narrowing it is defensible — unlike the
    // stats, which are the ledger's headline numbers.
    await listHypotheses({});
    expect(findManyWheres[0].forgettingStage).toBe('active');
  });

  test('can span every stage when asked', async () => {
    await listHypotheses({ stages: 'all' });
    expect(findManyWheres[0].forgettingStage).toBeUndefined();
  });

  test('filters by originTaskId in the query instead of leaving it to the caller', async () => {
    // The closing loop used to over-fetch 100 rows and filter in memory. With
    // 226 open hypotheses a task's own ones can fall outside that page, so the
    // verdict never finds them. Narrowing in the query makes the pool exact.
    await listHypotheses({ originTaskId: 1363, stages: 'all' });
    // The stored column is `taskId`; `originTaskId` is only this layer's name
    // for it, so filtering on the exposed name would be an unknown-argument
    // error at query time.
    expect(findManyWheres[0].taskId).toBe(1363);
    expect('originTaskId' in findManyWheres[0]).toBe(false);
  });

  test('leaves the task filter out of the where when it was not asked for', async () => {
    await listHypotheses({});
    expect('taskId' in findManyWheres[0]).toBe(false);
  });

  test('still maps each status name to its stored validationStatus', async () => {
    for (const [status, stored] of [
      ['open', 'pending'],
      ['supported', 'validated'],
      ['refuted', 'rejected'],
      ['inconclusive', 'conflict'],
    ] as const) {
      findManyWheres.length = 0;
      await listHypotheses({ status });
      expect(findManyWheres[0].validationStatus).toBe(stored);
    }
  });

  test('applies no status filter for "all"', async () => {
    await listHypotheses({ status: 'all' });
    expect(findManyWheres[0].validationStatus).toBeUndefined();
  });
});
