/**
 * contradiction-sweep.test
 *
 * Verifies the stale-conflict sweep: the batch primitive's resolution policy
 * (dead-side keeps the survivor, decayScore gap decides by outcome evidence,
 * LLM NO_CONTRADICTION dismisses, still-contested stays open), the afterId
 * cursor, and the drain loop's budget/termination/orphan-reversion behavior.
 * Own file — mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));

mock.module('./timeline', () => ({
  appendEvent: mock(() => Promise.resolve({ id: 1 })),
}));

mock.module('./rag/search', () => ({
  vectorSearch: mock(() => Promise.resolve([])),
}));

let aiResponse = '判定: NO_CONTRADICTION';
const sendAIMessage = mock(() => Promise.resolve({ content: aiResponse }));
mock.module('../../utils/ai-client', () => ({ sendAIMessage }));

const submitHypothesis = mock(() => Promise.resolve({ ok: true, id: 900 }));
mock.module('./hypothesis-service', () => ({ submitHypothesis }));

interface EntryLike {
  id: number;
  title: string;
  content: string;
  validationStatus: string;
  forgettingStage: string;
  decayScore: number;
}

function entry(id: number, overrides: Partial<EntryLike> = {}): EntryLike {
  return {
    id,
    title: `entry-${id}`,
    content: `content-${id}`,
    validationStatus: 'conflict',
    forgettingStage: 'active',
    decayScore: 0.5,
    ...overrides,
  };
}

interface ContradictionLike {
  id: number;
  entryAId: number;
  entryBId: number;
  entryA: EntryLike;
  entryB: EntryLike;
  resolution: string | null;
}

function contested(id: number): ContradictionLike {
  return {
    id,
    entryAId: id * 10,
    entryBId: id * 10 + 1,
    entryA: entry(id * 10),
    entryB: entry(id * 10 + 1),
    resolution: null,
  };
}

let contradictions: ContradictionLike[] = [];
const contradictionUpdates: Array<{ id: number; resolution: string }> = [];
const entryUpdateManyCalls: Array<Record<string, unknown>> = [];
const entryUpdateCalls: Array<Record<string, unknown>> = [];
const findManyCalls: Array<{ afterId: number; take: number }> = [];
let orphanRevertCount = 0;

mock.module('../../config/database', () => ({
  prisma: {
    knowledgeContradiction: {
      // Mirrors the real query shape so cursor tests are meaningful: filters
      // on resolution=null and id > afterId, honors take, sorts by id asc.
      findMany: mock((args: { where?: { id?: { gt?: number } }; take?: number }) => {
        const afterId = args?.where?.id?.gt ?? 0;
        const open = contradictions
          .filter((c) => c.resolution === null && c.id > afterId)
          .sort((a, b) => a.id - b.id);
        const take = args?.take ?? open.length;
        findManyCalls.push({ afterId, take });
        return Promise.resolve(open.slice(0, take));
      }),
      findUnique: mock((args: { where: { id: number } }) =>
        Promise.resolve(contradictions.find((c) => c.id === args.where.id) ?? null),
      ),
      update: mock((args: { where: { id: number }; data: { resolution: string } }) => {
        contradictionUpdates.push({ id: args.where.id, resolution: args.data.resolution });
        // Persist into the in-memory store so a drain loop's later batches
        // no longer see this contradiction as open.
        const c = contradictions.find((x) => x.id === args.where.id);
        if (c && args.data.resolution) c.resolution = args.data.resolution;
        return Promise.resolve({});
      }),
    },
    knowledgeEntry: {
      update: mock((args: Record<string, unknown>) => {
        entryUpdateCalls.push(args);
        return Promise.resolve({});
      }),
      updateMany: mock((args: { where: Record<string, unknown> }) => {
        entryUpdateManyCalls.push(args);
        // The orphan sweep is the only updateMany filtering on `contradictions`.
        if ('contradictions' in args.where) {
          return Promise.resolve({ count: orphanRevertCount });
        }
        return Promise.resolve({ count: 2 });
      }),
    },
  },
}));

const { revalidateStaleConflicts, drainStaleConflicts, revertOrphanedConflicts } =
  await import('./contradiction-sweep');

beforeEach(() => {
  contradictions = [];
  contradictionUpdates.length = 0;
  entryUpdateManyCalls.length = 0;
  entryUpdateCalls.length = 0;
  findManyCalls.length = 0;
  orphanRevertCount = 0;
  aiResponse = '判定: NO_CONTRADICTION';
  sendAIMessage.mockClear();
  submitHypothesis.mockClear();
  submitHypothesis.mockResolvedValue({ ok: true, id: 900 } as never);
});

describe('revalidateStaleConflicts', () => {
  test('one side rejected/archived → keeps the survivor without an LLM call', async () => {
    contradictions = [
      {
        id: 1,
        entryAId: 10,
        entryBId: 11,
        entryA: entry(10, { validationStatus: 'rejected' }),
        entryB: entry(11),
        resolution: null,
      },
    ];

    const result = await revalidateStaleConflicts();
    expect(result.resolved).toBe(1);
    expect(contradictionUpdates[0]).toEqual({ id: 1, resolution: 'keep_b' });
    expect(sendAIMessage).not.toHaveBeenCalled();
  });

  test('decayScore gap >= 0.3 keeps the outcome-proven entry', async () => {
    contradictions = [
      {
        id: 2,
        entryAId: 20,
        entryBId: 21,
        entryA: entry(20, { decayScore: 0.9 }),
        entryB: entry(21, { decayScore: 0.4 }),
        resolution: null,
      },
    ];

    const result = await revalidateStaleConflicts();
    expect(result.resolved).toBe(1);
    expect(contradictionUpdates[0]).toEqual({ id: 2, resolution: 'keep_a' });
    expect(sendAIMessage).not.toHaveBeenCalled();
  });

  test('LLM NO_CONTRADICTION re-check dismisses (both recover)', async () => {
    contradictions = [contested(3)];

    const result = await revalidateStaleConflicts();
    expect(result.resolved).toBe(1);
    expect(contradictionUpdates[0]).toEqual({ id: 3, resolution: 'dismiss' });
  });

  test('LLM-confirmed contradiction escalates to the hypothesis ledger and closes', async () => {
    aiResponse = '判定: CONTRADICTION';
    contradictions = [contested(4)];

    const result = await revalidateStaleConflicts();
    expect(result.resolved).toBe(1);
    expect(submitHypothesis).toHaveBeenCalledTimes(1);
    const statement = (submitHypothesis.mock.calls[0] as unknown as [{ statement: string }])[0]
      .statement;
    expect(statement).toContain('K-40'); // both entry ids traceable from the statement
    expect(statement).toContain('K-41');
    expect(contradictionUpdates[0]).toEqual({ id: 4, resolution: 'escalated_to_hypothesis' });
  });

  test('hypothesis rejection (not falsifiable) still closes the row', async () => {
    aiResponse = '判定: CONTRADICTION';
    submitHypothesis.mockResolvedValueOnce({ ok: false, reason: 'too short' } as never);
    contradictions = [contested(4)];

    const result = await revalidateStaleConflicts();
    expect(result.resolved).toBe(1);
    expect(contradictionUpdates[0]).toEqual({ id: 4, resolution: 'escalated_to_hypothesis' });
  });

  test('afterId cursor skips already-examined contradictions', async () => {
    aiResponse = '判定: CONTRADICTION';
    contradictions = [contested(1), contested(2), contested(3)];

    const first = await revalidateStaleConflicts(2, 0);
    expect(first.examined).toBe(2);
    expect(first.lastId).toBe(2);

    const second = await revalidateStaleConflicts(2, first.lastId!);
    expect(second.examined).toBe(1);
    expect(second.lastId).toBe(3);

    const third = await revalidateStaleConflicts(2, second.lastId!);
    expect(third.examined).toBe(0);
    expect(third.lastId).toBeNull();
  });
});

describe('drainStaleConflicts', () => {
  test('drains the whole backlog across multiple batches', async () => {
    contradictions = [contested(1), contested(2), contested(3)];

    const result = await drainStaleConflicts({ batchSize: 1 });
    expect(result.examined).toBe(3);
    expect(result.resolved).toBe(3);
    expect(contradictionUpdates.map((u) => u.id).sort()).toEqual([1, 2, 3]);
  });

  test('a fully-contested backlog drains via hypothesis escalation (one LLM check per pair)', async () => {
    aiResponse = '判定: CONTRADICTION';
    contradictions = [contested(1), contested(2)];

    const result = await drainStaleConflicts({ batchSize: 1 });
    expect(result.examined).toBe(2);
    expect(result.resolved).toBe(2); // escalated_to_hypothesis counts as resolved
    expect(sendAIMessage).toHaveBeenCalledTimes(2);
    expect(submitHypothesis).toHaveBeenCalledTimes(2);
  });

  test('respects the maxExamined budget', async () => {
    contradictions = [contested(1), contested(2), contested(3), contested(4), contested(5)];

    const result = await drainStaleConflicts({ batchSize: 2, maxExamined: 3 });
    expect(result.examined).toBe(3);
    // Batch sizing never overshoots the remaining budget (2 + 1, not 2 + 2).
    expect(findManyCalls.map((c) => c.take)).toEqual([2, 1]);
  });

  test('reverts orphaned conflict entries after draining', async () => {
    orphanRevertCount = 5;

    const result = await drainStaleConflicts({ batchSize: 5 });
    expect(result.orphansReverted).toBe(5);
    const orphanSweep = entryUpdateManyCalls.find((c) =>
      Object.hasOwn((c as { where: Record<string, unknown> }).where, 'contradictions'),
    ) as { where: Record<string, unknown>; data: Record<string, unknown> } | undefined;
    expect(orphanSweep).toBeDefined();
    expect(orphanSweep!.data).toEqual({ validationStatus: 'pending' });
  });
});

describe('revertOrphanedConflicts', () => {
  test('returns the reverted count', async () => {
    orphanRevertCount = 7;
    expect(await revertOrphanedConflicts()).toBe(7);
  });
});
