/**
 * validation.test
 *
 * Verifies revalidatePendingBacklog: oldest pending entries are re-run through
 * validateEntry, the sweep budget bounds the fetch, archived entries are
 * excluded, and a single failing entry doesn't halt the sweep. Own file —
 * mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));

// Empty vector results → validateEntry's duplicate/conflict stages are skipped
// and every reachable entry falls through to 'validated'.
mock.module('./rag/search', () => ({
  vectorSearch: mock(() => Promise.resolve([])),
}));

const sendAIMessage = mock(() => Promise.resolve({ content: 'CONSISTENT' }));
mock.module('../../utils/ai-client', () => ({ sendAIMessage }));

interface PendingEntry {
  id: number;
  title: string;
  content: string;
  contentHash: string;
  validationStatus: string;
  forgettingStage: string;
}

let pendingEntries: PendingEntry[] = [];
/** Entry ids findUnique should pretend don't exist (forces validateEntry to throw). */
let missingIds: number[] = [];
const entryUpdates: Array<{ id: number; status: string }> = [];
const findManyArgs: Array<{ where: Record<string, unknown>; take?: number }> = [];

mock.module('../../config/database', () => ({
  prisma: {
    knowledgeEntry: {
      findMany: mock((args: { where: Record<string, unknown>; take?: number }) => {
        findManyArgs.push(args);
        const take = args.take ?? pendingEntries.length;
        return Promise.resolve(pendingEntries.slice(0, take).map((e) => ({ id: e.id })));
      }),
      findUnique: mock((args: { where: { id: number } }) => {
        if (missingIds.includes(args.where.id)) return Promise.resolve(null);
        return Promise.resolve(pendingEntries.find((e) => e.id === args.where.id) ?? null);
      }),
      // No hash duplicates in these tests — every entry is unique.
      findFirst: mock(() => Promise.resolve(null)),
      update: mock((args: { where: { id: number }; data: { validationStatus?: string } }) => {
        if (args.data.validationStatus) {
          entryUpdates.push({ id: args.where.id, status: args.data.validationStatus });
        }
        return Promise.resolve({});
      }),
    },
  },
}));

const { revalidatePendingBacklog } = await import('./validation');

function pending(id: number): PendingEntry {
  return {
    id,
    title: `entry-${id}`,
    content: `content-${id}`,
    contentHash: `hash-${id}`,
    validationStatus: 'pending',
    forgettingStage: 'active',
  };
}

beforeEach(() => {
  pendingEntries = [];
  missingIds = [];
  entryUpdates.length = 0;
  findManyArgs.length = 0;
  sendAIMessage.mockClear();
});

describe('revalidatePendingBacklog', () => {
  test('validates each pending entry and reports outcome counts', async () => {
    pendingEntries = [pending(1), pending(2), pending(3)];

    const result = await revalidatePendingBacklog();
    expect(result.examined).toBe(3);
    expect(result.validated).toBe(3);
    expect(result.failed).toBe(0);
    expect(entryUpdates).toEqual([
      { id: 1, status: 'validated' },
      { id: 2, status: 'validated' },
      { id: 3, status: 'validated' },
    ]);
  });

  test('passes the budget as the fetch limit and excludes archived entries', async () => {
    pendingEntries = [pending(1), pending(2), pending(3)];

    const result = await revalidatePendingBacklog(2);
    expect(result.examined).toBe(2);
    expect(findManyArgs[0].take).toBe(2);
    expect(findManyArgs[0].where).toEqual({
      validationStatus: 'pending',
      forgettingStage: { not: 'archived' },
    });
  });

  test('a failing entry is counted and does not halt the sweep', async () => {
    pendingEntries = [pending(1), pending(2), pending(3)];
    missingIds = [2]; // validateEntry throws "KnowledgeEntry not found: 2"

    const result = await revalidatePendingBacklog();
    expect(result.examined).toBe(3);
    expect(result.validated).toBe(2);
    expect(result.failed).toBe(1);
    expect(entryUpdates.map((u) => u.id)).toEqual([1, 3]);
  });

  test('empty backlog is a no-op', async () => {
    const result = await revalidatePendingBacklog();
    expect(result).toEqual({ examined: 0, validated: 0, rejected: 0, conflict: 0, failed: 0 });
  });
});
