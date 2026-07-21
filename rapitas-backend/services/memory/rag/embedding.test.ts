import { describe, test, expect, mock } from 'bun:test';

// Mock @xenova/transformers so tests never load the real (slow, ~100MB)
// ML model or hit this repo's known-broken subprocess fallback (missing
// sharp native binding in this environment — see project history).
const mockCreatePipeline = mock(() =>
  Promise.resolve((text: string) => {
    // Deterministic "embedding": a fixed-length vector derived from text length,
    // just needs to be a Float32Array-like shape for the real code to consume.
    const data = new Float32Array(4).fill(text.length / 100);
    return Promise.resolve({ data });
  }),
);
mock.module('@xenova/transformers', () => ({
  pipeline: mockCreatePipeline,
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

const { generateEmbedding, generateEmbeddings, resetEmbeddingPipeline } =
  await import('./embedding');

describe('resetEmbeddingPipeline', () => {
  test('does not throw', () => {
    expect(() => resetEmbeddingPipeline()).not.toThrow();
  });
});

describe('generateEmbedding', () => {
  test('returns an embedding with the expected model/dimension metadata', async () => {
    resetEmbeddingPipeline();
    const result = await generateEmbedding('hello world');
    expect(result.model).toBe('Xenova/all-MiniLM-L6-v2');
    expect(result.dimension).toBe(384);
    expect(Array.isArray(result.embedding)).toBe(true);
    expect(result.embedding).toHaveLength(4);
  });

  test('initializes the pipeline only once across repeated calls', async () => {
    resetEmbeddingPipeline();
    mockCreatePipeline.mockClear();
    await generateEmbedding('first');
    await generateEmbedding('second');
    expect(mockCreatePipeline).toHaveBeenCalledTimes(1);
  });
});

describe('generateEmbeddings', () => {
  test('generates one embedding per input text, in order', async () => {
    resetEmbeddingPipeline();
    const results = await generateEmbeddings(['a', 'bb', 'ccc']);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.model).toBe('Xenova/all-MiniLM-L6-v2');
      expect(r.dimension).toBe(384);
    }
  });

  test('returns an empty array for an empty input list', async () => {
    resetEmbeddingPipeline();
    expect(await generateEmbeddings([])).toEqual([]);
  });
});
