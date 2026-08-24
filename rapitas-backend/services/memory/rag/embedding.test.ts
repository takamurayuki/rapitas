import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

// Mock @xenova/transformers so tests never load the real (slow, ~100MB)
// ML model or hit this repo's known-broken subprocess fallback (missing
// sharp native binding in this environment — see project history).
const mockCreatePipeline = mock((_task: string, _model: string) =>
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

const {
  generateEmbedding,
  generateEmbeddings,
  resetEmbeddingPipeline,
  getActiveEmbeddingModel,
  getConfiguredEmbeddingModel,
  ensureEmbeddingReady,
  LEGACY_EMBEDDING_MODEL,
} = await import('./embedding');

// bun auto-loads .env; the dev .env may pin a multilingual model, so start
// every case from the code default and only opt in explicitly.
beforeEach(() => {
  delete process.env.RAPITAS_EMBEDDING_MODEL;
  resetEmbeddingPipeline();
});
afterEach(() => {
  delete process.env.RAPITAS_EMBEDDING_MODEL;
  resetEmbeddingPipeline();
});

describe('resetEmbeddingPipeline', () => {
  test('does not throw and clears the active model', () => {
    expect(() => resetEmbeddingPipeline()).not.toThrow();
    expect(getActiveEmbeddingModel()).toBeNull();
  });
});

describe('generateEmbedding', () => {
  test('returns the legacy model and the OUTPUT length as dimension by default', async () => {
    resetEmbeddingPipeline();
    const result = await generateEmbedding('hello world');
    expect(result.model).toBe(LEGACY_EMBEDDING_MODEL);
    expect(result.model).toBe('Xenova/all-MiniLM-L6-v2');
    // dimension follows the model actually loaded (mock yields 4 floats).
    expect(result.dimension).toBe(4);
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

  test('loads the model named by RAPITAS_EMBEDDING_MODEL and reports it', async () => {
    process.env.RAPITAS_EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
    resetEmbeddingPipeline();
    mockCreatePipeline.mockClear();
    expect(getConfiguredEmbeddingModel()).toBe('Xenova/paraphrase-multilingual-MiniLM-L12-v2');
    const result = await generateEmbedding('こんにちは');
    expect(mockCreatePipeline.mock.calls[0][1]).toBe(
      'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    );
    expect(result.model).toBe('Xenova/paraphrase-multilingual-MiniLM-L12-v2');
    expect(getActiveEmbeddingModel()).toBe('Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  });

  test('falls back to the legacy model when the configured one fails to load', async () => {
    process.env.RAPITAS_EMBEDDING_MODEL = 'Xenova/does-not-exist';
    resetEmbeddingPipeline();
    mockCreatePipeline.mockClear();
    mockCreatePipeline.mockImplementationOnce(() => Promise.reject(new Error('download failed')));
    const result = await generateEmbedding('text');
    expect(mockCreatePipeline).toHaveBeenCalledTimes(2);
    expect(mockCreatePipeline.mock.calls[1][1]).toBe(LEGACY_EMBEDDING_MODEL);
    expect(result.model).toBe(LEGACY_EMBEDDING_MODEL);
    // Active (actual) model differs from the configured one after a fallback.
    expect(getActiveEmbeddingModel()).toBe(LEGACY_EMBEDDING_MODEL);
    expect(getConfiguredEmbeddingModel()).toBe('Xenova/does-not-exist');
  });
});

describe('ensureEmbeddingReady', () => {
  test('initializes and returns the active model name', async () => {
    resetEmbeddingPipeline();
    expect(await ensureEmbeddingReady()).toBe(LEGACY_EMBEDDING_MODEL);
    expect(getActiveEmbeddingModel()).toBe(LEGACY_EMBEDDING_MODEL);
  });
});

describe('generateEmbeddings', () => {
  test('generates one embedding per input text, in order', async () => {
    resetEmbeddingPipeline();
    const results = await generateEmbeddings(['a', 'bb', 'ccc']);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.model).toBe(LEGACY_EMBEDDING_MODEL);
      expect(r.dimension).toBe(4);
    }
  });

  test('returns an empty array for an empty input list', async () => {
    resetEmbeddingPipeline();
    expect(await generateEmbeddings([])).toEqual([]);
  });
});
