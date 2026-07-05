/**
 * contradiction.revalidate.test
 *
 * Verifies revalidateStaleConflicts' resolution policy: dead-side keeps the
 * survivor, a decayScore gap decides by outcome evidence, an LLM
 * NO_CONTRADICTION re-check dismisses, a still-contested pair stays open, and
 * orphaned conflict entries revert to 'pending'. Own file — mock.module is
 * process-global.
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

let contradictions: ContradictionLike[] = [];
const contradictionUpdates: Array<{ id: number; resolution: string }> = [];
const entryUpdateManyCalls: Array<Record<string, unknown>> = [];
const entryUpdateCalls: Array<Record<string, unknown>> = [];
let orphanRevertCount = 0;

mock.module('../../config/database', () => ({
  prisma: {
    knowledgeContradiction: {
      findMany: mock(() => Promise.resolve(contradictions)),
      findUnique: mock((args: { where: { id: number } }) =>
        Promise.resolve(contradictions.find((c) => c.id === args.where.id) ?? null),
      ),
      update: mock((args: { where: { id: number }; data: { resolution: string } }) => {
        contradictionUpdates.push({ id: args.where.id, resolution: args.data.resolution });
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

const { revalidateStaleConflicts } = await import('./contradiction');

beforeEach(() => {
  contradictions = [];
  contradictionUpdates.length = 0;
  entryUpdateManyCalls.length = 0;
  entryUpdateCalls.length = 0;
  orphanRevertCount = 0;
  aiResponse = '判定: NO_CONTRADICTION';
  sendAIMessage.mockClear();
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
    contradictions = [
      {
        id: 3,
        entryAId: 30,
        entryBId: 31,
        entryA: entry(30),
        entryB: entry(31),
        resolution: null,
      },
    ];

    const result = await revalidateStaleConflicts();
    expect(result.resolved).toBe(1);
    expect(contradictionUpdates[0]).toEqual({ id: 3, resolution: 'dismiss' });
  });

  test('still-contested pair stays unresolved', async () => {
    aiResponse = '判定: CONTRADICTION';
    contradictions = [
      {
        id: 4,
        entryAId: 40,
        entryBId: 41,
        entryA: entry(40),
        entryB: entry(41),
        resolution: null,
      },
    ];

    const result = await revalidateStaleConflicts();
    expect(result.resolved).toBe(0);
    expect(contradictionUpdates).toHaveLength(0);
  });

  test('orphaned conflict entries are reverted to pending', async () => {
    orphanRevertCount = 5;
    await revalidateStaleConflicts();
    const orphanSweep = entryUpdateManyCalls.find((c) =>
      Object.hasOwn((c as { where: Record<string, unknown> }).where, 'contradictions'),
    ) as { where: Record<string, unknown>; data: Record<string, unknown> } | undefined;
    expect(orphanSweep).toBeDefined();
    expect(orphanSweep!.data).toEqual({ validationStatus: 'pending' });
  });
});
