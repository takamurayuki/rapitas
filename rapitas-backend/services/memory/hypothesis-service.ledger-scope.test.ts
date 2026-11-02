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

let findFirstRow: Record<string, unknown> | null = null;
const updates: Array<Record<string, unknown>> = [];
const deletes: Array<Record<string, unknown>> = [];
let findManyRows: Array<Record<string, unknown>> = [];

const prisma = {
  knowledgeEntry: {
    count: mock(async ({ where }: { where: Where }) => {
      countWheres.push(where);
      return 0;
    }),
    findMany: mock(async ({ where }: { where: Where }) => {
      findManyWheres.push(where);
      return findManyRows;
    }),
    findFirst: mock(async () => findFirstRow),
    update: mock(async (args: Record<string, unknown>) => {
      updates.push(args);
      return {};
    }),
    delete: mock(async (args: Record<string, unknown>) => {
      deletes.push(args);
      return {};
    }),
  },
};
mock.module('../../config/database', () => ({
  prisma,
  ensureDatabaseConnection: mock(async () => {}),
}));

const { getHypothesisStats, listHypotheses, getHypothesis, setHypothesisStatus, deleteHypothesis } =
  await import('./hypothesis-service');

/** A stored hypothesis row, in the shape HYP_SELECT asks for. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 13855,
    title: 'Docker 不在時のみ skipIf',
    content: 'rationale',
    category: 'codebase',
    confidence: 0.8,
    validationStatus: 'validated',
    forgettingStage: 'archived',
    tags: '[]',
    themeId: 35,
    taskId: 1363,
    createdAt: new Date('2026-10-19T00:00:00Z'),
    updatedAt: new Date('2026-10-19T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  countWheres.length = 0;
  findManyWheres.length = 0;
  updates.length = 0;
  deletes.length = 0;
  findFirstRow = null;
  findManyRows = [];
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

// These three are reachable from the ledger page and were untested, so the
// split that moved them could have broken them silently.
describe('getHypothesis', () => {
  test('maps a stored row to an entry, and is NOT narrowed by stage', async () => {
    findFirstRow = row({ forgettingStage: 'archived' });
    const entry = await getHypothesis(13855);

    expect(entry?.id).toBe(13855);
    // The asymmetry that produced #1321: a single fetch sees an archived
    // hypothesis, while the list and the stats did not.
    expect(entry?.status).toBe('supported');
    expect(entry?.originTaskId).toBe(1363);
  });

  test('returns null when nothing matches', async () => {
    findFirstRow = null;
    expect(await getHypothesis(1)).toBeNull();
  });
});

describe('setHypothesisStatus', () => {
  test('refuses an id that does not exist', async () => {
    findFirstRow = null;
    expect(await setHypothesisStatus(1, 'supported')).toBe(false);
    expect(updates).toHaveLength(0);
  });

  test.each([
    ['supported', 'validated'],
    ['refuted', 'rejected'],
    ['inconclusive', 'conflict'],
    ['open', 'pending'],
  ] as const)('maps %s to validationStatus %s', async (status, stored) => {
    findFirstRow = row();
    expect(await setHypothesisStatus(13855, status)).toBe(true);

    const data = updates[0].data as { validationStatus: string; validatedAt: Date | null };
    expect(data.validationStatus).toBe(stored);
    // Reopening clears the timestamp; closing stamps it.
    expect(data.validatedAt === null).toBe(stored === 'pending');
  });
});

describe('deleteHypothesis', () => {
  test('refuses an id that does not exist', async () => {
    findFirstRow = null;
    expect(await deleteHypothesis(1)).toBe(false);
    expect(deletes).toHaveLength(0);
  });

  test('deletes by id when it exists', async () => {
    findFirstRow = row();
    expect(await deleteHypothesis(13855)).toBe(true);
    expect(deletes[0].where).toEqual({ id: 13855 });
  });
});
