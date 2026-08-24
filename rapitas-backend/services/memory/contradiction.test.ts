/**
 * contradiction.test
 *
 * Verifies detectContradictions does not register a KnowledgeContradiction
 * row when the LLM verdict is NO_CONTRADICTION (regression for the
 * `.includes('CONTRADICTION')` substring bug — "NO_CONTRADICTION" contains
 * "CONTRADICTION" so a plain includes() check always registered a row).
 * Own file — mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));

mock.module('./timeline', () => ({
  appendEvent: mock(() => Promise.resolve({ id: 1 })),
}));

let searchResults: Array<{ knowledgeEntryId: number }> = [];
mock.module('./rag/search', () => ({
  vectorSearch: mock(() => Promise.resolve(searchResults)),
}));

let aiResponse = '判定: NO_CONTRADICTION';
const sendAIMessage = mock(() => Promise.resolve({ content: aiResponse }));
mock.module('../../utils/ai-client', () => ({ sendAIMessage }));

interface EntryLike {
  id: number;
  title: string;
  content: string;
  decayScore: number;
}

// Distinct wording per id so isNearDuplicatePair's bigram-Jaccard check does
// not flag the pair as a paraphrase before the LLM branch under test runs.
const WORDING: Record<number, { title: string; content: string }> = {
  1: { title: 'postgres接続プール枯渇の対処', content: 'コネクションプールの上限を引き上げる' },
  2: { title: 'フロントエンドi18nキー欠落', content: '翻訳ファイルにキーを追加する' },
};

function entry(id: number, overrides: Partial<EntryLike> = {}): EntryLike {
  const w = WORDING[id] ?? { title: `entry-${id}`, content: `content-${id}` };
  return {
    id,
    title: w.title,
    content: w.content,
    decayScore: 0.5,
    ...overrides,
  };
}

let entries: Map<number, EntryLike>;
const contradictionCreateCalls: Array<Record<string, unknown>> = [];
let existingContradiction: unknown = null;
let openCount = 0;

mock.module('../../config/database', () => ({
  prisma: {
    knowledgeEntry: {
      findUnique: mock((args: { where: { id: number } }) =>
        Promise.resolve(entries.get(args.where.id) ?? null),
      ),
      update: mock(() => Promise.resolve({})),
      updateMany: mock(() => Promise.resolve({ count: 2 })),
    },
    knowledgeContradiction: {
      count: mock(() => Promise.resolve(openCount)),
      findFirst: mock(() => Promise.resolve(existingContradiction)),
      create: mock((args: { data: Record<string, unknown> }) => {
        contradictionCreateCalls.push(args.data);
        return Promise.resolve({ id: 1, ...args.data });
      }),
    },
  },
}));

const { detectContradictions } = await import('./contradiction');

beforeEach(() => {
  entries = new Map([
    [1, entry(1)],
    [2, entry(2)],
  ]);
  searchResults = [{ knowledgeEntryId: 2 }];
  contradictionCreateCalls.length = 0;
  existingContradiction = null;
  openCount = 0;
  aiResponse = '判定: NO_CONTRADICTION';
  sendAIMessage.mockClear();
});

describe('detectContradictions', () => {
  test('LLM verdict NO_CONTRADICTION does not create a record', async () => {
    aiResponse = '判定: NO_CONTRADICTION';

    const count = await detectContradictions(1);

    expect(count).toBe(0);
    expect(contradictionCreateCalls).toHaveLength(0);
  });

  test('LLM verdict NO_CONTRADICTION with a trailing explanation still skips the record', async () => {
    // The 174 backlog rows all carried a description saying "no contradiction
    // between either entry" — reproduces that shape to guard the fix.
    aiResponse = '判定: NO_CONTRADICTION\n説明: どちらのエントリにも矛盾がない';

    const count = await detectContradictions(1);

    expect(count).toBe(0);
    expect(contradictionCreateCalls).toHaveLength(0);
  });

  test('LLM verdict CONTRADICTION creates a record with type and description', async () => {
    aiResponse = '判定: CONTRADICTION\n種類: factual\n説明: 数値が食い違う';

    const count = await detectContradictions(1);

    expect(count).toBe(1);
    expect(contradictionCreateCalls).toHaveLength(1);
    expect(contradictionCreateCalls[0]).toMatchObject({
      entryAId: 1,
      entryBId: 2,
      contradictionType: 'factual',
      description: '数値が食い違う',
    });
  });

  test('an existing contradiction record short-circuits without calling the LLM', async () => {
    existingContradiction = { id: 99 };

    const count = await detectContradictions(1);

    expect(count).toBe(0);
    expect(sendAIMessage).not.toHaveBeenCalled();
  });

  test('the open-contradiction cap stops before calling the LLM', async () => {
    openCount = 3; // MAX_OPEN_PER_ENTRY default

    const count = await detectContradictions(1);

    expect(count).toBe(0);
    expect(sendAIMessage).not.toHaveBeenCalled();
  });

  test('a near-duplicate pair is deduped without an LLM call', async () => {
    entries.set(2, entry(2, { title: 'entry-1', content: entries.get(1)!.content }));

    const count = await detectContradictions(1);

    expect(count).toBe(0);
    expect(sendAIMessage).not.toHaveBeenCalled();
  });

  test('an LLM failure is skipped without throwing', async () => {
    sendAIMessage.mockImplementationOnce(() => Promise.reject(new Error('provider down')));

    const count = await detectContradictions(1);

    expect(count).toBe(0);
    expect(contradictionCreateCalls).toHaveLength(0);
  });
});
