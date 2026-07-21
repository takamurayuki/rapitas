import { describe, test, expect, mock } from 'bun:test';

const mockSearchKnowledge = mock(() => Promise.resolve<unknown[]>([]));
mock.module('./search', () => ({
  searchKnowledge: mockSearchKnowledge,
}));
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

  test('passes limit/minSimilarity/themeId through to searchKnowledge', async () => {
    mockSearchKnowledge.mockResolvedValueOnce([]);
    await buildRAGContext('q', { limit: 3, minSimilarity: 0.7, themeId: 5 });
    expect(mockSearchKnowledge).toHaveBeenCalledWith({
      query: 'q',
      limit: 3,
      minSimilarity: 0.7,
      forgettingStage: 'active',
      themeId: 5,
    });
  });

  test('defaults limit=5, minSimilarity=0.6 when options are omitted', async () => {
    mockSearchKnowledge.mockResolvedValueOnce([]);
    await buildRAGContext('q');
    expect(mockSearchKnowledge).toHaveBeenCalledWith({
      query: 'q',
      limit: 5,
      minSimilarity: 0.6,
      forgettingStage: 'active',
      themeId: undefined,
    });
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
        minSimilarity: 0.5,
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
