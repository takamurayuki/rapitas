/**
 * hybrid-search テスト
 *
 * ベクトル+語彙の RRF 統合順位、語彙のみヒットの hydrate、テーマフォールバック
 * （試行イベントは 1 回）、語彙/ベクトル例外時の縮退、telemetry の有無と payload を検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

interface VectorRow {
  id: number;
  title: string;
  content: string;
  category: string;
  confidence: number;
  forgettingStage: string;
  similarity: number;
  tags: string[];
  createdAt: Date;
  taskId: number | null;
  validationStatus: string;
}
interface LexHit {
  id: number;
  score: number;
  rankScore: number;
}

const mockSearchKnowledge = mock((_opts: Record<string, unknown>) =>
  Promise.resolve([] as VectorRow[]),
);
const mockLexicalSearch = mock((_q: string, _opts: Record<string, unknown>) =>
  Promise.resolve([] as LexHit[]),
);
const mockAppendEvent = mock((_ev: Record<string, unknown>) => Promise.resolve({ id: 1 }));
const mockFindMany = mock((_args: Record<string, unknown>) =>
  Promise.resolve([] as Array<Record<string, unknown>>),
);

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
}));
mock.module('../../../config/database', () => ({
  prisma: { knowledgeEntry: { findMany: mockFindMany } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../rag/search', () => ({ searchKnowledge: mockSearchKnowledge }));
mock.module('../rag/embedding', () => ({ getActiveEmbeddingModel: () => 'test-model' }));
mock.module('./lexical-index', () => ({ lexicalSearch: mockLexicalSearch }));
mock.module('../timeline', () => ({ appendEvent: mockAppendEvent }));

const { searchKnowledgeHybrid } = await import('./hybrid-search');
const { resetRecallConfigCache } = await import('./recall-config');

function vrow(id: number, similarity: number, over: Partial<VectorRow> = {}): VectorRow {
  return {
    id,
    title: `t${id}`,
    content: `c${id}`,
    category: 'general',
    confidence: 1,
    forgettingStage: 'active',
    similarity,
    tags: [],
    createdAt: new Date(0),
    taskId: null,
    validationStatus: 'pending',
    ...over,
  };
}
function dbrow(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `t${id}`,
    content: `c${id}`,
    category: 'general',
    confidence: 1,
    forgettingStage: 'archived',
    tags: '[]',
    createdAt: new Date(0),
    taskId: null,
    validationStatus: 'pending',
    ...over,
  };
}

beforeEach(() => {
  resetRecallConfigCache();
  mockSearchKnowledge.mockReset().mockReturnValue(Promise.resolve([]));
  mockLexicalSearch.mockReset().mockReturnValue(Promise.resolve([]));
  mockAppendEvent.mockReset().mockReturnValue(Promise.resolve({ id: 1 }));
  mockFindMany.mockReset().mockReturnValue(Promise.resolve([]));
});

describe('searchKnowledgeHybrid — 統合', () => {
  test('両チャネル出現が先頭、残りは id 昇順。語彙のみは hydrate されて channel=lexical', async () => {
    mockSearchKnowledge.mockReturnValue(Promise.resolve([vrow(1, 0.8), vrow(2, 0.7)]));
    mockLexicalSearch.mockReturnValue(
      Promise.resolve([
        { id: 2, score: 0.5, rankScore: 0.5 },
        { id: 3, score: 0.4, rankScore: 0.4 },
      ]),
    );
    mockFindMany.mockReturnValue(Promise.resolve([dbrow(3)]));

    const hits = await searchKnowledgeHybrid({ query: 'q', limit: 6 });
    expect(hits.map((h) => h.id)).toEqual([2, 1, 3]);
    expect(hits[0].channel).toBe('both');
    expect(hits[0].lexicalScore).toBe(0.5);
    expect(hits[0].similarity).toBe(0.7);
    expect(hits[1].channel).toBe('vector');
    expect(hits[1].lexicalScore).toBeNull();
    expect(hits[2].channel).toBe('lexical');
    expect(hits[2].similarity).toBe(0);
    expect(hits[2].forgettingStage).toBe('archived');
    // hydrate only asked for the lexical-only id and re-applied eligibility filters.
    const where = mockFindMany.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.id).toEqual({ in: [3] });
    expect(where.validationStatus).toEqual({ not: 'rejected' });
    expect(where.forgettingStage).toEqual({ in: ['active', 'dormant', 'archived'] });
  });

  test('limit で切り詰め、ベクトルチャネルには limit×2 と全ステージ・重みを渡す', async () => {
    mockSearchKnowledge.mockReturnValue(
      Promise.resolve([vrow(1, 0.9), vrow(2, 0.8), vrow(3, 0.7)]),
    );
    const hits = await searchKnowledgeHybrid({ query: 'q', limit: 2, themeId: 9 });
    expect(hits).toHaveLength(2);
    const opts = mockSearchKnowledge.mock.calls[0][0];
    expect(opts.limit).toBe(4);
    expect(opts.forgettingStage).toEqual(['active', 'dormant', 'archived']);
    expect(opts.stageWeights).toEqual({ active: 1, dormant: 0.85, archived: 0.6 });
    expect(opts.minSimilarity).toBe(0.55);
    expect(opts.themeId).toBe(9);
    expect(mockLexicalSearch.mock.calls[0][1].themeId).toBe(9);
  });

  test('lexical=false なら語彙チャネルを呼ばない', async () => {
    await searchKnowledgeHybrid({ query: 'q', lexical: false });
    expect(mockLexicalSearch).not.toHaveBeenCalled();
  });

  test('hydrate で消えた(不適格)語彙ヒットはスキップされる', async () => {
    mockLexicalSearch.mockReturnValue(Promise.resolve([{ id: 7, score: 0.3, rankScore: 0.3 }]));
    mockFindMany.mockReturnValue(Promise.resolve([]));
    expect(await searchKnowledgeHybrid({ query: 'q' })).toEqual([]);
  });
});

describe('searchKnowledgeHybrid — フォールバックと縮退', () => {
  test('テーマ 0 件なら themeId 無しで再検索し、試行イベントは 1 回だけ記録', async () => {
    mockSearchKnowledge
      .mockReturnValueOnce(Promise.resolve([]))
      .mockReturnValueOnce(Promise.resolve([vrow(5, 0.6)]));
    const hits = await searchKnowledgeHybrid({
      query: 'q',
      themeId: 3,
      themeFallback: true,
      telemetry: { source: 'workflow', taskId: 42 },
    });
    expect(hits.map((h) => h.id)).toEqual([5]);
    expect(mockSearchKnowledge).toHaveBeenCalledTimes(2);
    expect(mockSearchKnowledge.mock.calls[0][0].themeId).toBe(3);
    expect(mockSearchKnowledge.mock.calls[1][0].themeId).toBeUndefined();
    await Promise.resolve();
    expect(mockAppendEvent).toHaveBeenCalledTimes(1);
    const ev = mockAppendEvent.mock.calls[0][0];
    const payload = ev.payload as Record<string, unknown>;
    expect(ev.eventType).toBe('memory_recall_attempt');
    expect(ev.correlationId).toBe('task_42');
    expect(payload.themeFallbackUsed).toBe(true);
    expect(payload.returned).toBe(1);
  });

  test('themeFallback 無しならテーマ 0 件でも再検索しない', async () => {
    await searchKnowledgeHybrid({ query: 'q', themeId: 3 });
    expect(mockSearchKnowledge).toHaveBeenCalledTimes(1);
  });

  test('語彙チャネルが throw してもベクトル結果で継続', async () => {
    mockSearchKnowledge.mockReturnValue(Promise.resolve([vrow(1, 0.9)]));
    mockLexicalSearch.mockReturnValue(Promise.reject(new Error('index broken')));
    const hits = await searchKnowledgeHybrid({ query: 'q' });
    expect(hits.map((h) => h.id)).toEqual([1]);
  });

  test('ベクトルチャネルが throw（埋め込み無効）しても語彙結果で継続', async () => {
    mockSearchKnowledge.mockReturnValue(Promise.reject(new Error('embeddings disabled')));
    mockLexicalSearch.mockReturnValue(Promise.resolve([{ id: 4, score: 0.25, rankScore: 0.25 }]));
    mockFindMany.mockReturnValue(Promise.resolve([dbrow(4)]));
    const hits = await searchKnowledgeHybrid({ query: 'q' });
    expect(hits.map((h) => h.id)).toEqual([4]);
    expect(hits[0].channel).toBe('lexical');
  });
});

describe('searchKnowledgeHybrid — telemetry', () => {
  test('telemetry 無しではイベントを記録しない', async () => {
    await searchKnowledgeHybrid({ query: 'q' });
    await Promise.resolve();
    expect(mockAppendEvent).not.toHaveBeenCalled();
  });

  test('空振りでも returned: 0 で記録し、payload に計測項目が揃う', async () => {
    await searchKnowledgeHybrid({ query: 'q', telemetry: { source: 'api' } });
    await Promise.resolve();
    expect(mockAppendEvent).toHaveBeenCalledTimes(1);
    const payload = mockAppendEvent.mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      source: 'api',
      taskId: null,
      model: 'test-model',
      stages: ['active', 'dormant', 'archived'],
      lexicalEnabled: true,
      vectorCandidates: 0,
      lexicalCandidates: 0,
      returned: 0,
      topSimilarity: null,
      topLexical: null,
      themeFallbackUsed: false,
    });
    expect(typeof payload.durationMs).toBe('number');
  });

  test('topSimilarity / topLexical は各チャネルの最大値', async () => {
    mockSearchKnowledge.mockReturnValue(Promise.resolve([vrow(1, 0.61), vrow(2, 0.7)]));
    mockLexicalSearch.mockReturnValue(
      Promise.resolve([
        { id: 1, score: 0.2, rankScore: 0.2 },
        { id: 9, score: 0.33, rankScore: 0.33 },
      ]),
    );
    mockFindMany.mockReturnValue(Promise.resolve([dbrow(9)]));
    await searchKnowledgeHybrid({ query: 'q', telemetry: { source: 'task_rag' } });
    await Promise.resolve();
    const payload = mockAppendEvent.mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload.topSimilarity).toBe(0.7);
    expect(payload.topLexical).toBe(0.33);
    expect(payload.vectorCandidates).toBe(2);
    expect(payload.lexicalCandidates).toBe(2);
    expect(payload.returned).toBe(3);
  });

  test('イベント記録の失敗は検索結果に影響しない', async () => {
    mockSearchKnowledge.mockReturnValue(Promise.resolve([vrow(1, 0.9)]));
    mockAppendEvent.mockReturnValue(Promise.reject(new Error('db down')));
    const hits = await searchKnowledgeHybrid({ query: 'q', telemetry: { source: 'workflow' } });
    expect(hits).toHaveLength(1);
  });
});
