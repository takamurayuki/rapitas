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
// Mirrors the real module's `env.backends.onnx.wasm` shape so
// configureOnnxRuntime() has something to mutate (task #698 regression guard).
// A getter (rather than a fixed object) lets individual tests swap in a
// write-resistant stand-in to exercise the read-back verification path.
let currentWasmConfig: Record<string, unknown> = {};
mock.module('@xenova/transformers', () => ({
  pipeline: mockCreatePipeline,
  env: {
    backends: {
      onnx: {
        get wasm() {
          return currentWasmConfig;
        },
      },
    },
  },
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
  isEmbeddingSubprocess,
  LEGACY_EMBEDDING_MODEL,
} = await import('./embedding');

// bun auto-loads .env; the dev .env may pin a multilingual model, so start
// every case from the code default and only opt in explicitly.
beforeEach(() => {
  delete process.env.RAPITAS_EMBEDDING_MODEL;
  currentWasmConfig = {};
  resetEmbeddingPipeline();
});
afterEach(() => {
  delete process.env.RAPITAS_EMBEDDING_MODEL;
  currentWasmConfig = {};
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

describe('configureOnnxRuntime (blob worker crash guard, task #698)', () => {
  test('pins the ONNX runtime to a single WASM thread and disables the proxy worker', async () => {
    resetEmbeddingPipeline();
    currentWasmConfig = {};
    await generateEmbedding('trigger init');
    // Multi-threaded/proxied WASM spawns workers from blob URLs that Bun
    // cannot open (ENOENT), crashing the process — see embedding.ts docs.
    expect(currentWasmConfig.numThreads).toBe(1);
    expect(currentWasmConfig.proxy).toBe(false);
    expect(mockCreatePipeline).toHaveBeenCalled();
  });

  test('refuses the in-process pipeline when thread pinning cannot be verified', async () => {
    resetEmbeddingPipeline();
    mockCreatePipeline.mockClear();
    // Simulates a future @xenova/transformers version whose wasm config
    // object accepts writes but does not actually persist them — the
    // "shape is not part of any contract we control" risk documented in
    // embedding.ts. The write must appear to succeed (no throw) while the
    // read-back still shows the multi-threaded default, so this exercises
    // the verification branch, not the try/catch fallback.
    currentWasmConfig = new Proxy(
      {},
      {
        set: () => true,
        get: () => undefined,
      },
    );
    await ensureEmbeddingReady();
    // Must NOT have taken the in-process path — that is exactly the path
    // that crashes the backend when thread pinning silently fails.
    expect(mockCreatePipeline).not.toHaveBeenCalled();
    // Falls back to the subprocess (isolated process — a crash there cannot
    // take down the backend the way an in-process blob worker crash does).
    expect(isEmbeddingSubprocess()).toBe(true);
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
