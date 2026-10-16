import { describe, test, expect, afterAll } from 'bun:test';
import {
  upsertEmbedding,
  deleteEmbedding,
  searchSimilar,
  getEmbeddingCount,
  countEmbeddingsByModel,
  getEmbeddingModels,
  closeVectorDb,
} from './vector-index';

// This module has no injectable DB path — it always opens the real
// data/knowledge-vectors.db file. Use a clearly out-of-range id band so these
// tests can never collide with a real KnowledgeEntry id, and clean up
// everything in afterAll so the shared file is left exactly as found.
const TEST_ID_BASE = 999_900_000;
const testIds: number[] = [];

afterAll(() => {
  for (const id of testIds) {
    deleteEmbedding(id);
  }
  closeVectorDb();
});

describe('upsertEmbedding / searchSimilar / getEmbeddingCount / deleteEmbedding', () => {
  test('stores and finds an embedding via cosine similarity', () => {
    const id = TEST_ID_BASE + 1;
    testIds.push(id);
    upsertEmbedding(id, [1, 0, 0], 'test preview text');

    const results = searchSimilar([1, 0, 0], 10, 0.9, []);
    const found = results.find((r) => r.knowledgeEntryId === id);
    expect(found).toBeDefined();
    expect(found!.similarity).toBeCloseTo(1, 5);
    expect(found!.textPreview).toBe('test preview text');
  });

  test('upsert overwrites an existing embedding for the same id', () => {
    const id = TEST_ID_BASE + 2;
    testIds.push(id);
    upsertEmbedding(id, [1, 0, 0], 'first');
    upsertEmbedding(id, [0, 1, 0], 'second');

    // Now orthogonal to [1,0,0] -> similarity ~0, but parallel to [0,1,0].
    const results = searchSimilar([0, 1, 0], 10, 0.9, []);
    const found = results.find((r) => r.knowledgeEntryId === id);
    expect(found).toBeDefined();
    expect(found!.textPreview).toBe('second');
  });

  test('excludeIds filters out specified entries', () => {
    const id = TEST_ID_BASE + 3;
    testIds.push(id);
    upsertEmbedding(id, [0, 0, 1], 'excluded');

    const results = searchSimilar([0, 0, 1], 10, 0.9, [id]);
    expect(results.find((r) => r.knowledgeEntryId === id)).toBeUndefined();
  });

  test('minSimilarity filters out low-similarity results', () => {
    const id = TEST_ID_BASE + 4;
    testIds.push(id);
    upsertEmbedding(id, [1, 0, 0], 'orthogonal target');

    // Query orthogonal to the stored vector -> similarity ~0, below threshold.
    const results = searchSimilar([0, 1, 0], 10, 0.99, []);
    expect(results.find((r) => r.knowledgeEntryId === id)).toBeUndefined();
  });

  test('limit truncates the result set', () => {
    const ids = [TEST_ID_BASE + 10, TEST_ID_BASE + 11, TEST_ID_BASE + 12];
    for (const id of ids) {
      testIds.push(id);
      upsertEmbedding(id, [1, 0, 0], `entry-${id}`);
    }
    const results = searchSimilar([1, 0, 0], 2, 0.9, []);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test('deleteEmbedding removes the entry from subsequent searches', () => {
    const id = TEST_ID_BASE + 20;
    upsertEmbedding(id, [1, 1, 1], 'to be deleted');
    expect(searchSimilar([1, 1, 1], 10, 0.9, []).some((r) => r.knowledgeEntryId === id)).toBe(true);

    deleteEmbedding(id);
    expect(searchSimilar([1, 1, 1], 10, 0.9, []).some((r) => r.knowledgeEntryId === id)).toBe(
      false,
    );
  });

  test('getEmbeddingCount reflects at least the entries this test inserted', () => {
    const before = getEmbeddingCount();
    const id = TEST_ID_BASE + 30;
    testIds.push(id);
    upsertEmbedding(id, [1, 2, 3], 'count test');
    expect(getEmbeddingCount()).toBe(before + 1);
  });
});

describe('model-scoped search / countEmbeddingsByModel / getEmbeddingModels', () => {
  test('rows embedded by another model are invisible to a model-scoped search', () => {
    const legacyId = TEST_ID_BASE + 40;
    const otherId = TEST_ID_BASE + 41;
    testIds.push(legacyId, otherId);
    upsertEmbedding(legacyId, [1, 0, 0], 'legacy', 'model-A');
    upsertEmbedding(otherId, [1, 0, 0], 'other', 'model-B');

    const scoped = searchSimilar([1, 0, 0], 10, 0.9, [], 'model-A');
    expect(scoped.some((r) => r.knowledgeEntryId === legacyId)).toBe(true);
    expect(scoped.some((r) => r.knowledgeEntryId === otherId)).toBe(false);

    // Unscoped (legacy signature) still sees both.
    const all = searchSimilar([1, 0, 0], 10, 0.9, []);
    expect(all.some((r) => r.knowledgeEntryId === otherId)).toBe(true);
  });

  test('countEmbeddingsByModel counts each model separately', () => {
    const a = TEST_ID_BASE + 50;
    const b = TEST_ID_BASE + 51;
    testIds.push(a, b);
    const before = countEmbeddingsByModel();
    upsertEmbedding(a, [0, 1, 0], 'a', 'count-model-X');
    upsertEmbedding(b, [0, 1, 0], 'b', 'count-model-Y');
    const after = countEmbeddingsByModel();
    expect(after['count-model-X']).toBe((before['count-model-X'] ?? 0) + 1);
    expect(after['count-model-Y']).toBe((before['count-model-Y'] ?? 0) + 1);
  });

  test('getEmbeddingModels maps ids to their model and omits missing ids', () => {
    const a = TEST_ID_BASE + 60;
    testIds.push(a);
    upsertEmbedding(a, [0, 0, 1], 'a', 'map-model');
    const map = getEmbeddingModels([a, TEST_ID_BASE + 61]);
    expect(map.get(a)).toBe('map-model');
    expect(map.has(TEST_ID_BASE + 61)).toBe(false);
    expect(getEmbeddingModels([]).size).toBe(0);
  });
});
