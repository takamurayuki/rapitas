/**
 * memory/rag/search — searchKnowledge のランキングテスト
 *
 * rankScore = similarity * TRUST_WEIGHT[validationStatus] による並べ替えと、
 * 同点時の id 昇順タイブレーク（再現性のため固定順）、REFUTED除外は呼び出し側の
 * where 条件で担保されること、limit によるスライス、vectorSearch が空のときの
 * 早期return、rankScore フィールドが最終出力から除去されることを検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { VectorSearchResult } from '../../../services/memory/types';

let vectorResults: VectorSearchResult[] = [];
let embeddingCalls = 0;
let searchSimilarCalls: unknown[] = [];

mock.module('../../../services/memory/rag/embedding', () => ({
  generateEmbedding: (query: string) => {
    embeddingCalls += 1;
    return Promise.resolve({ embedding: [0.1, 0.2, 0.3], model: 'test', dimension: 3, query });
  },
}));

mock.module('../../../services/memory/rag/vector-index', () => ({
  searchSimilar: (
    embedding: number[],
    limit: number,
    minSimilarity: number,
    excludeIds: number[],
  ) => {
    searchSimilarCalls.push({ embedding, limit, minSimilarity, excludeIds });
    return vectorResults;
  },
}));

interface KnowledgeEntryRow {
  id: number;
  title: string;
  content: string;
  category: string;
  confidence: number;
  forgettingStage: string;
  tags: string;
  createdAt: Date;
  taskId: number | null;
  validationStatus: string;
}

let entries: KnowledgeEntryRow[] = [];
let lastWhere: Record<string, unknown> | null = null;

mock.module('../../../config/database', () => ({
  prisma: {
    knowledgeEntry: {
      findMany: ({ where }: { where: Record<string, unknown> }) => {
        lastWhere = where;
        return Promise.resolve(entries);
      },
    },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { searchKnowledge, vectorSearch } = await import('../../../services/memory/rag/search');

function entry(overrides: Partial<KnowledgeEntryRow>): KnowledgeEntryRow {
  return {
    id: 1,
    title: 't',
    content: 'c',
    category: 'pattern',
    confidence: 0.5,
    forgettingStage: 'active',
    tags: '[]',
    createdAt: new Date('2024-01-01'),
    taskId: null,
    validationStatus: 'pending',
    ...overrides,
  };
}

function vres(id: number, similarity: number): VectorSearchResult {
  return { knowledgeEntryId: id, similarity, textPreview: null };
}

beforeEach(() => {
  vectorResults = [];
  entries = [];
  lastWhere = null;
  embeddingCalls = 0;
  searchSimilarCalls = [];
});

describe('searchKnowledge — rankScore の信頼度加重', () => {
  test('validated(1.25倍) は同一 similarity の pending(1.0倍) より上位に来る', async () => {
    vectorResults = [vres(1, 0.6), vres(2, 0.6)];
    entries = [
      entry({ id: 1, title: 'pending-entry', validationStatus: 'pending' }),
      entry({ id: 2, title: 'validated-entry', validationStatus: 'validated' }),
    ];
    const results = await searchKnowledge({ query: 'q' });
    expect(results.map((r) => r.id)).toEqual([2, 1]); // validated first despite same similarity
  });

  test('conflict(0.5倍) は同一 similarity の pending より下位に来る', async () => {
    vectorResults = [vres(1, 0.6), vres(2, 0.6)];
    entries = [
      entry({ id: 1, title: 'conflict-entry', validationStatus: 'conflict' }),
      entry({ id: 2, title: 'pending-entry', validationStatus: 'pending' }),
    ];
    const results = await searchKnowledge({ query: 'q' });
    expect(results.map((r) => r.id)).toEqual([2, 1]); // pending beats conflict
  });

  test('rankScore が真に同点なら id 昇順にタイブレークされる（決定的順序）', async () => {
    // Same similarity + same validationStatus → identical rankScore.
    vectorResults = [vres(5, 0.7), vres(2, 0.7), vres(9, 0.7)];
    entries = [
      entry({ id: 5, validationStatus: 'pending' }),
      entry({ id: 2, validationStatus: 'pending' }),
      entry({ id: 9, validationStatus: 'pending' }),
    ];
    const results = await searchKnowledge({ query: 'q' });
    expect(results.map((r) => r.id)).toEqual([2, 5, 9]);
  });

  test('rankScore フィールドは最終出力に含まれない（内部専用）', async () => {
    vectorResults = [vres(1, 0.6)];
    entries = [entry({ id: 1 })];
    const results = await searchKnowledge({ query: 'q' });
    expect(results[0]).not.toHaveProperty('rankScore');
  });

  test('高い生 similarity は低信頼度加重を覆せる（0.9 conflict > 0.5 pending）', async () => {
    vectorResults = [vres(1, 0.9), vres(2, 0.5)];
    entries = [
      entry({ id: 1, validationStatus: 'conflict' }), // 0.9*0.5=0.45
      entry({ id: 2, validationStatus: 'pending' }), // 0.5*1.0=0.5
    ];
    const results = await searchKnowledge({ query: 'q' });
    expect(results.map((r) => r.id)).toEqual([2, 1]); // 0.5 > 0.45
  });
});

describe('searchKnowledge — limit / early-return / where 条件', () => {
  test('limit でスライスされる（上位のみ返る）', async () => {
    vectorResults = [vres(1, 0.9), vres(2, 0.8), vres(3, 0.7)];
    entries = [entry({ id: 1 }), entry({ id: 2 }), entry({ id: 3 })];
    const results = await searchKnowledge({ query: 'q', limit: 2 });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toEqual([1, 2]);
  });

  test('vectorSearch が空を返したら DB へ問い合わせずに空配列を返す', async () => {
    vectorResults = [];
    const results = await searchKnowledge({ query: 'q' });
    expect(results).toEqual([]);
    expect(lastWhere).toBeNull(); // findMany was never called
  });

  test('rejected の validationStatus は where 条件で除外される', async () => {
    vectorResults = [vres(1, 0.9)];
    entries = [entry({ id: 1 })];
    await searchKnowledge({ query: 'q' });
    expect(lastWhere?.validationStatus).toEqual({ not: 'rejected' });
  });

  test('forgettingStage / category / themeId が指定されると where に反映される', async () => {
    vectorResults = [vres(1, 0.9)];
    entries = [entry({ id: 1 })];
    await searchKnowledge({
      query: 'q',
      forgettingStage: 'active',
      category: 'pattern',
      themeId: 7,
    });
    expect(lastWhere?.forgettingStage).toBe('active');
    expect(lastWhere?.category).toBe('pattern');
    expect(lastWhere?.themeId).toBe(7);
  });
});

describe('vectorSearch — デフォルト値の委譲', () => {
  test('generateEmbedding と searchSimilar へクエリ/デフォルト閾値を渡す', async () => {
    vectorResults = [vres(1, 0.9)];
    const results = await vectorSearch({ query: 'hello' });
    expect(embeddingCalls).toBe(1);
    expect(searchSimilarCalls[0]).toMatchObject({ limit: 10, minSimilarity: 0.5, excludeIds: [] });
    expect(results).toEqual(vectorResults);
  });
});
