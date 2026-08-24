import { describe, test, expect, mock } from 'bun:test';

const mockSearchKnowledge = mock(() => Promise.resolve<unknown[]>([]));
mock.module('../recall/hybrid-search', () => ({
  searchKnowledgeHybrid: mockSearchKnowledge,
}));
const ALL_STAGES = ['active', 'dormant', 'archived'];
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

const { buildRAGContext, buildTaskRAGContext } = await import('./context-builder');

describe('buildRAGContext', () => {
  test('returns empty entries and contextText when no results are found', async () => {
    mockSearchKnowledge.mockResolvedValueOnce([]);
    const result = await buildRAGContext('some query');
    expect(result).toEqual({ query: 'some query', entries: [], contextText: '' });
  });

  test('maps search results into entries and builds a contextText header', async () => {
    mockSearchKnowledge.mockResolvedValueOnce([
      {
        id: 1,
        title: 'テスト知識',
        content: '本文',
        category: 'bugfix',
        confidence: 0.8,
        similarity: 0.9,
      },
    ]);
    const result = await buildRAGContext('query');
    expect(result.entries).toEqual([
      {
        id: 1,
        title: 'テスト知識',
        content: '本文',
        category: 'bugfix',
        confidence: 0.8,
        similarity: 0.9,
      },
    ]);
    expect(result.contextText).toContain('## 関連する知識ベース');
    expect(result.contextText).toContain('1. テスト知識');
    expect(result.contextText).toContain('信頼度: 80%');
    expect(result.contextText).toContain('類似度: 90%');
    expect(result.contextText).toContain('本文');
  });

  test('passes limit/minSimilarity/themeId through, with config stages and task_rag telemetry', async () => {
    mockSearchKnowledge.mockResolvedValueOnce([]);
    await buildRAGContext('q', { limit: 3, minSimilarity: 0.7, themeId: 5 });
    expect(mockSearchKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'q',
        limit: 3,
        minSimilarity: 0.7,
        stages: ALL_STAGES,
        themeId: 5,
        telemetry: { source: 'task_rag' },
      }),
    );
  });

  test('defaults limit=5 and the config minSimilarity (0.55) when options are omitted', async () => {
    mockSearchKnowledge.mockResolvedValueOnce([]);
    await buildRAGContext('q');
    expect(mockSearchKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'q',
        limit: 5,
        minSimilarity: 0.55,
        stages: ALL_STAGES,
        themeId: undefined,
      }),
    );
  });

  test('lexical-only hits surface their lexicalScore as the similarity', async () => {
    mockSearchKnowledge.mockResolvedValueOnce([
      {
        id: 3,
        title: '語彙ヒット',
        content: '本文',
        category: 'x',
        confidence: 1,
        similarity: 0,
        channel: 'lexical',
        lexicalScore: 0.3,
      },
    ]);
    const result = await buildRAGContext('q');
    expect(result.entries[0].similarity).toBe(0.3);
    expect(result.contextText).toContain('類似度: 30%');
  });

  test('returns an empty context (not a throw) when searchKnowledge rejects', async () => {
    mockSearchKnowledge.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const result = await buildRAGContext('q');
    expect(result).toEqual({ query: 'q', entries: [], contextText: '' });
  });
});

describe('buildTaskRAGContext', () => {
  test('joins title and description into the search query', async () => {
    mockSearchKnowledge.mockResolvedValueOnce([]);
    await buildTaskRAGContext({ title: 'タイトル', description: '説明文', themeId: 7 });
    expect(mockSearchKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'タイトル 説明文',
        themeId: 7,
        limit: 5,
        // No per-caller constant any more — the recall config floor applies.
        minSimilarity: 0.55,
      }),
    );
  });

  test('omits the description when it is null', async () => {
    mockSearchKnowledge.mockResolvedValueOnce([]);
    await buildTaskRAGContext({ title: 'タイトルのみ', description: null, themeId: null });
    expect(mockSearchKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'タイトルのみ', themeId: undefined }),
    );
  });

  test('returns the built contextText string directly', async () => {
    mockSearchKnowledge.mockResolvedValueOnce([
      {
        id: 2,
        title: 'T',
        content: 'C',
        category: 'x',
        confidence: 1,
        similarity: 1,
      },
    ]);
    const text = await buildTaskRAGContext({ title: 'タイトル' });
    expect(typeof text).toBe('string');
    expect(text).toContain('C');
  });
});
