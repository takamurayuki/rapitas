/**
 * search.determinism.test
 *
 * Locks the RAG recall ranking guarantee: when candidate entries tie on the
 * trust-weighted rankScore, the top-`limit` slice fed into the prompt is
 * ordered deterministically by id (Array#sort is not guaranteed stable across
 * engines for equal keys).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockGenerateEmbedding = mock(() => Promise.resolve({ embedding: [0.1, 0.2, 0.3] }));
const mockSearchSimilar = mock(() => Promise.resolve([]));
const mockKnowledgeEntryFindMany = mock(() => Promise.resolve([]));

mock.module('./embedding', () => ({ generateEmbedding: mockGenerateEmbedding }));
mock.module('./vector-index', () => ({ searchSimilar: mockSearchSimilar }));
mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: { knowledgeEntry: { findMany: mockKnowledgeEntryFindMany } },
}));

const { searchKnowledge } = await import('./search');

/** A KB row with all fields searchKnowledge selects; equal similarity → equal rankScore. */
const row = (id: number) => ({
  id,
  title: `t${id}`,
  content: `c${id}`,
  category: 'lesson',
  confidence: 0.8,
  forgettingStage: 'active',
  tags: '[]',
  createdAt: new Date('2026-01-01'),
  taskId: null,
  validationStatus: 'pending', // TRUST_WEIGHT 1.0 for all → identical rankScore
});

describe('searchKnowledge — stable order on equal rankScore', () => {
  beforeEach(() => {
    mockGenerateEmbedding.mockClear();
    mockSearchSimilar.mockReset();
    mockKnowledgeEntryFindMany.mockReset();
  });

  it('breaks rankScore ties by id ascending', async () => {
    const ids = [5, 2, 8, 1, 3];
    // Every candidate has the SAME cosine similarity → same rankScore.
    mockSearchSimilar.mockResolvedValue(
      ids.map((id) => ({ knowledgeEntryId: id, similarity: 0.7 })),
    );
    // Return rows in a deliberately non-id order to prove the sort, not the input, wins.
    mockKnowledgeEntryFindMany.mockResolvedValue([8, 3, 1, 5, 2].map(row));

    const results = await searchKnowledge({ query: 'anything', limit: 10 });

    expect(results.map((r) => r.id)).toEqual([1, 2, 3, 5, 8]);
  });
});
