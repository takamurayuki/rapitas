import { describe, test, expect, mock } from 'bun:test';

const mockGenerateEmbedding = mock(() =>
  Promise.resolve({ embedding: [1, 0, 0], model: 'test-model', dimension: 3 }),
);
mock.module('./embedding', () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

const mockSearchSimilar = mock(
  () => [] as Array<{ knowledgeEntryId: number; similarity: number; textPreview: string | null }>,
);
mock.module('./vector-index', () => ({
  searchSimilar: mockSearchSimilar,
}));

const mockFindMany = mock(() => Promise.resolve<Array<Record<string, unknown>>>([]));
mock.module('../../../config/database', () => ({
  prisma: { knowledgeEntry: { findMany: mockFindMany } },
}));

const { vectorSearch, searchKnowledge } = await import('./search');

describe('vectorSearch', () => {
  test('generates an embedding for the query and delegates to searchSimilar', async () => {
    mockSearchSimilar.mockReturnValueOnce([
      { knowledgeEntryId: 1, similarity: 0.9, textPreview: 'preview' },
    ]);
    const result = await vectorSearch({ query: 'test query' });
    expect(result).toEqual([{ knowledgeEntryId: 1, similarity: 0.9, textPreview: 'preview' }]);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith('test query');
  });

  test('applies default limit/minSimilarity/excludeIds', async () => {
    mockSearchSimilar.mockClear();
    await vectorSearch({ query: 'q' });
    expect(mockSearchSimilar).toHaveBeenCalledWith([1, 0, 0], 10, 0.5, [], 'test-model');
  });

  test('passes through explicit options', async () => {
    mockSearchSimilar.mockClear();
    await vectorSearch({ query: 'q', limit: 5, minSimilarity: 0.8, excludeIds: [1, 2] });
    expect(mockSearchSimilar).toHaveBeenCalledWith([1, 0, 0], 5, 0.8, [1, 2], 'test-model');
  });
});

describe('searchKnowledge', () => {
  test('returns an empty array immediately when the vector search finds nothing', async () => {
    mockSearchSimilar.mockReturnValueOnce([]);
    mockFindMany.mockClear();
    const result = await searchKnowledge({ query: 'nothing matches' });
    expect(result).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  test('merges vector results with DB entries and computes similarity', async () => {
    mockSearchSimilar.mockReturnValueOnce([
      { knowledgeEntryId: 1, similarity: 0.8, textPreview: null },
    ]);
    mockFindMany.mockResolvedValueOnce([
      {
        id: 1,
        title: 'T',
        content: 'C',
        category: 'bugfix',
        confidence: 0.9,
        forgettingStage: 'active',
        tags: '["a","b"]',
        createdAt: new Date('2020-01-01'),
        taskId: 5,
        validationStatus: 'pending',
      },
    ]);
    const result = await searchKnowledge({ query: 'q' });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 1, similarity: 0.8, tags: ['a', 'b'] });
  });

  test('excludes REJECTED (refuted) entries via the where clause', async () => {
    mockSearchSimilar.mockReturnValueOnce([
      { knowledgeEntryId: 1, similarity: 0.8, textPreview: null },
    ]);
    mockFindMany.mockClear();
    mockFindMany.mockResolvedValueOnce([]);
    await searchKnowledge({ query: 'q' });
    const whereArg = mockFindMany.mock.calls[0][0].where;
    expect(whereArg.validationStatus).toEqual({ not: 'rejected' });
  });

  test('applies forgettingStage/category/themeId filters when provided', async () => {
    mockSearchSimilar.mockReturnValueOnce([
      { knowledgeEntryId: 1, similarity: 0.8, textPreview: null },
    ]);
    mockFindMany.mockClear();
    mockFindMany.mockResolvedValueOnce([]);
    await searchKnowledge({
      query: 'q',
      forgettingStage: 'active',
      category: 'bugfix',
      themeId: 7,
    });
    const whereArg = mockFindMany.mock.calls[0][0].where;
    expect(whereArg.forgettingStage).toBe('active');
    expect(whereArg.category).toBe('bugfix');
    expect(whereArg.themeId).toBe(7);
  });

  test('accepts an array of forgettingStages as an { in } filter', async () => {
    mockSearchSimilar.mockReturnValueOnce([
      { knowledgeEntryId: 1, similarity: 0.8, textPreview: null },
    ]);
    mockFindMany.mockClear();
    mockFindMany.mockResolvedValueOnce([]);
    await searchKnowledge({ query: 'q', forgettingStage: ['active', 'archived'] });
    const whereArg = mockFindMany.mock.calls[0][0].where;
    expect(whereArg.forgettingStage).toEqual({ in: ['active', 'archived'] });
  });

  test('requests limit × candidateMultiplier vector candidates (default 5)', async () => {
    mockSearchSimilar.mockClear();
    mockSearchSimilar.mockReturnValueOnce([]);
    await searchKnowledge({ query: 'q', limit: 4 });
    expect(mockSearchSimilar.mock.calls[0][1]).toBe(20);
    mockSearchSimilar.mockClear();
    mockSearchSimilar.mockReturnValueOnce([]);
    await searchKnowledge({ query: 'q', limit: 4, candidateMultiplier: 2 });
    expect(mockSearchSimilar.mock.calls[0][1]).toBe(8);
  });

  test('stageWeights demote archived entries below equally similar active ones', async () => {
    mockSearchSimilar.mockReturnValueOnce([
      { knowledgeEntryId: 1, similarity: 0.8, textPreview: null },
      { knowledgeEntryId: 2, similarity: 0.8, textPreview: null },
    ]);
    const base = {
      content: 'c',
      category: 'x',
      confidence: 1,
      tags: '[]',
      createdAt: new Date(),
      taskId: null,
      validationStatus: 'pending',
    };
    mockFindMany.mockResolvedValueOnce([
      { ...base, id: 1, title: 'archived', forgettingStage: 'archived' },
      { ...base, id: 2, title: 'active', forgettingStage: 'active' },
    ]);
    const result = await searchKnowledge({
      query: 'q',
      forgettingStage: ['active', 'archived'],
      stageWeights: { active: 1, archived: 0.6 },
    });
    expect(result.map((r) => r.title)).toEqual(['active', 'archived']);
    // similarity stays the raw cosine — only ordering changes.
    expect(result[1].similarity).toBe(0.8);
  });

  test('ranks validated entries above pending, and pending above conflict, at equal similarity', async () => {
    mockSearchSimilar.mockReturnValueOnce([
      { knowledgeEntryId: 1, similarity: 0.8, textPreview: null },
      { knowledgeEntryId: 2, similarity: 0.8, textPreview: null },
      { knowledgeEntryId: 3, similarity: 0.8, textPreview: null },
    ]);
    mockFindMany.mockResolvedValueOnce([
      {
        id: 1,
        title: 'conflict',
        content: 'c',
        category: 'x',
        confidence: 1,
        forgettingStage: 'active',
        tags: '[]',
        createdAt: new Date(),
        taskId: null,
        validationStatus: 'conflict',
      },
      {
        id: 2,
        title: 'validated',
        content: 'c',
        category: 'x',
        confidence: 1,
        forgettingStage: 'active',
        tags: '[]',
        createdAt: new Date(),
        taskId: null,
        validationStatus: 'validated',
      },
      {
        id: 3,
        title: 'pending',
        content: 'c',
        category: 'x',
        confidence: 1,
        forgettingStage: 'active',
        tags: '[]',
        createdAt: new Date(),
        taskId: null,
        validationStatus: 'pending',
      },
    ]);
    const result = await searchKnowledge({ query: 'q' });
    expect(result.map((r) => r.title)).toEqual(['validated', 'pending', 'conflict']);
  });

  test('truncates results to the requested limit', async () => {
    mockSearchSimilar.mockReturnValueOnce([
      { knowledgeEntryId: 1, similarity: 0.9, textPreview: null },
      { knowledgeEntryId: 2, similarity: 0.8, textPreview: null },
    ]);
    mockFindMany.mockResolvedValueOnce([
      {
        id: 1,
        title: 'a',
        content: 'c',
        category: 'x',
        confidence: 1,
        forgettingStage: 'active',
        tags: '[]',
        createdAt: new Date(),
        taskId: null,
        validationStatus: 'pending',
      },
      {
        id: 2,
        title: 'b',
        content: 'c',
        category: 'x',
        confidence: 1,
        forgettingStage: 'active',
        tags: '[]',
        createdAt: new Date(),
        taskId: null,
        validationStatus: 'pending',
      },
    ]);
    const result = await searchKnowledge({ query: 'q', limit: 1 });
    expect(result).toHaveLength(1);
  });
});
