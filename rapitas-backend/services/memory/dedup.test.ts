/**
 * dedup テスト
 *
 * findSemanticDuplicate: threshold-gated cosine lookup, exclude-list
 * plumbing, empty-content short-circuit, and the fail-open behaviour when
 * embedding generation throws (must never block the write).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

let embeddingResult: { embedding: number[] } | null = { embedding: [0.1, 0.2, 0.3] };
let embeddingError: Error | null = null;
let similarHits: Array<{
  knowledgeEntryId: number;
  similarity: number;
  textPreview: string | null;
}> = [];
let lastSearchArgs: {
  embedding: number[];
  limit: number;
  threshold: number;
  excludeIds: number[];
} | null = null;

mock.module('./rag/embedding', () => ({
  generateEmbedding: (_content: string) => {
    if (embeddingError) return Promise.reject(embeddingError);
    return Promise.resolve(embeddingResult);
  },
}));

mock.module('./rag/vector-index', () => ({
  searchSimilar: (embedding: number[], limit: number, threshold: number, excludeIds: number[]) => {
    lastSearchArgs = { embedding, limit, threshold, excludeIds };
    return similarHits;
  },
}));

const { findSemanticDuplicate } = await import('./dedup');

beforeEach(() => {
  embeddingError = null;
  similarHits = [];
  lastSearchArgs = null;
});

describe('findSemanticDuplicate', () => {
  test('empty/whitespace-only content short-circuits to null without generating an embedding', async () => {
    const r = await findSemanticDuplicate('   ');
    expect(r).toBeNull();
    expect(lastSearchArgs).toBeNull();
  });

  test('a hit at/above the threshold returns its knowledgeEntryId', async () => {
    similarHits = [{ knowledgeEntryId: 42, similarity: 0.95, textPreview: 'x' }];
    const r = await findSemanticDuplicate('some content');
    expect(r).toBe(42);
  });

  test('no hits above threshold → null', async () => {
    similarHits = [];
    const r = await findSemanticDuplicate('novel content');
    expect(r).toBeNull();
  });

  test('passes the default threshold (0.9) and excludeIds through to searchSimilar', async () => {
    await findSemanticDuplicate('content', [1, 2, 3]);
    expect(lastSearchArgs).not.toBeNull();
    expect(lastSearchArgs!.threshold).toBe(0.9);
    expect(lastSearchArgs!.excludeIds).toEqual([1, 2, 3]);
    expect(lastSearchArgs!.limit).toBe(1);
  });

  test('an explicit threshold argument overrides the default', async () => {
    await findSemanticDuplicate('content', [], 0.75);
    expect(lastSearchArgs!.threshold).toBe(0.75);
  });

  test('fail-open: embedding generation failure returns null (never blocks the write)', async () => {
    embeddingError = new Error('subprocess crashed');
    const r = await findSemanticDuplicate('content');
    expect(r).toBeNull();
  });
});
