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
  contentHash: string;
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
    contentHash: `hash-${id}`,
    ...overrides,
  };
}

let entries: Map<number, EntryLike>;
const contradictionCreateCalls: Array<Record<string, unknown>> = [];
const contradictionDeleteCalls: Array<{ where: { id: number } }> = [];
let existingContradiction: Record<string, unknown> | null = null;
let openCount = 0;

const entryUpdateMany = mock(() => Promise.resolve({ count: 2 }));

mock.module('../../config/database', () => ({
  prisma: {
    knowledgeEntry: {
      findUnique: mock((args: { where: { id: number } }) =>
        Promise.resolve(entries.get(args.where.id) ?? null),
      ),
      update: mock(() => Promise.resolve({})),
      updateMany: entryUpdateMany,
    },
    knowledgeContradiction: {
      count: mock(() => Promise.resolve(openCount)),
      findFirst: mock(() => Promise.resolve(existingContradiction)),
      create: mock((args: { data: Record<string, unknown> }) => {
        contradictionCreateCalls.push(args.data);
        return Promise.resolve({ id: 1, ...args.data });
      }),
      delete: mock((args: { where: { id: number } }) => {
        contradictionDeleteCalls.push(args);
        return Promise.resolve({ id: args.where.id });
      }),
    },
  },
}));

/** Structured CONTRADICTION response with both claims well over the length gate. */
function structuredContradiction(confidence: number, description = '数値が食い違う'): string {
  return [
    '判定: CONTRADICTION',
    '種類: factual',
    '対立命題A: エントリAはコネクションプールの上限を引き上げるべきだと明確に主張している',
    '対立命題B: エントリBはコネクションプールの上限を下げるべきだと明確に主張している',
    '引用箇所A: services/db/pool.ts:12',
    '引用箇所B: docs/db.md',
    '適用時点A: 2026-09',
    '適用時点B: 2026-08',
    'コード版A: abc123',
    'コード版B: def456',
    `確信度: ${confidence}`,
    `説明: ${description}`,
  ].join('\n');
}

const { detectContradictions } = await import('./contradiction');

beforeEach(() => {
  entries = new Map([
    [1, entry(1)],
    [2, entry(2)],
  ]);
  searchResults = [{ knowledgeEntryId: 2 }];
  contradictionCreateCalls.length = 0;
  contradictionDeleteCalls.length = 0;
  existingContradiction = null;
  openCount = 0;
  aiResponse = '判定: NO_CONTRADICTION';
  sendAIMessage.mockClear();
  entryUpdateMany.mockClear();
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

  test('high-confidence structured CONTRADICTION creates a record and conflicts both entries', async () => {
    aiResponse = structuredContradiction(0.9);

    const count = await detectContradictions(1);

    expect(count).toBe(1);
    expect(contradictionCreateCalls).toHaveLength(1);
    expect(contradictionCreateCalls[0]).toMatchObject({
      entryAId: 1,
      entryBId: 2,
      contradictionType: 'factual',
      description: '数値が食い違う',
      citationA: 'services/db/pool.ts:12',
      citationB: 'docs/db.md',
      asOfA: '2026-09',
      asOfB: '2026-08',
      codeVersionA: 'abc123',
      codeVersionB: 'def456',
      confidence: 0.9,
      needsReview: false,
      contentHashAAtDetection: 'hash-1',
      contentHashBAtDetection: 'hash-2',
    });
    // claimA/claimB captured, both well over the 20-char gate.
    expect((contradictionCreateCalls[0]!.claimA as string).length).toBeGreaterThanOrEqual(20);
    expect((contradictionCreateCalls[0]!.claimB as string).length).toBeGreaterThanOrEqual(20);
    // High confidence → both entries marked conflicting.
    expect(entryUpdateMany).toHaveBeenCalled();
  });

  test('heading-only description ("**主な矛盾点：**"のみ) does not extract a usable claim', async () => {
    aiResponse = [
      '判定: CONTRADICTION',
      '種類: factual',
      '対立命題A: **主な矛盾点：**',
      '対立命題B: ',
    ].join('\n');

    const count = await detectContradictions(1);

    expect(count).toBe(0);
    expect(contradictionCreateCalls).toHaveLength(0);
    expect(entryUpdateMany).not.toHaveBeenCalled();
  });

  test('low-confidence structured contradiction records a row but does NOT conflict the entries', async () => {
    aiResponse = structuredContradiction(0.5);

    const count = await detectContradictions(1);

    expect(count).toBe(1);
    expect(contradictionCreateCalls).toHaveLength(1);
    expect(contradictionCreateCalls[0]).toMatchObject({ needsReview: true, confidence: 0.5 });
    // Low confidence → neither entry is pulled out of recall.
    expect(entryUpdateMany).not.toHaveBeenCalled();
  });

  test('a RESOLVED contradiction record short-circuits without calling the LLM', async () => {
    existingContradiction = { id: 99, resolution: 'dismiss' };

    const count = await detectContradictions(1);

    expect(count).toBe(0);
    expect(sendAIMessage).not.toHaveBeenCalled();
    expect(contradictionDeleteCalls).toHaveLength(0);
  });

  test('an unresolved pair whose content is unchanged still short-circuits', async () => {
    existingContradiction = {
      id: 88,
      resolution: null,
      entryAId: 1,
      entryBId: 2,
      contentHashAAtDetection: 'hash-1',
      contentHashBAtDetection: 'hash-2',
    };

    const count = await detectContradictions(1);

    expect(count).toBe(0);
    expect(sendAIMessage).not.toHaveBeenCalled();
    expect(contradictionDeleteCalls).toHaveLength(0);
  });

  test('content change on an unresolved pair triggers re-detection instead of short-circuiting', async () => {
    // entry 1's content was corrected since detection → its stored hash is stale.
    entries.set(1, entry(1, { contentHash: 'hash-1-corrected' }));
    existingContradiction = {
      id: 77,
      resolution: null,
      entryAId: 1,
      entryBId: 2,
      contentHashAAtDetection: 'hash-1', // old hash, no longer matches
      contentHashBAtDetection: 'hash-2',
    };
    aiResponse = structuredContradiction(0.9);

    const count = await detectContradictions(1);

    // Stale row dropped, LLM consulted again, fresh row created.
    expect(contradictionDeleteCalls).toEqual([{ where: { id: 77 } }]);
    expect(sendAIMessage).toHaveBeenCalled();
    expect(count).toBe(1);
    expect(contradictionCreateCalls).toHaveLength(1);
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
