import { describe, test, expect, mock, spyOn } from 'bun:test';

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
// NOTE: mock.module is process-global in bun — mirror ALL config/logger exports
// (createLogger / logger / getBackendLogFilePath) so co-executed test files that
// import any of them do not break on a partial mock.
const loggerStub = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => loggerStub,
  logger: loggerStub,
  getBackendLogFilePath: () => '',
}));

const { generateEmbedding, generateEmbeddings, resetEmbeddingPipeline, writeWorkerRequest } =
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

describe('writeWorkerRequest', () => {
  test('resolves even when end() returns an EOF-like rejection (dead pipe)', async () => {
    // Reproduces task #507: the worker crashes at require time, end() rejects with
    // EOF (errno -136) and — before the fix — the rejection escaped as a
    // process-level unhandledRejection.
    const sink = {
      write: () => 1,
      end: () =>
        Promise.reject(
          Object.assign(new Error('EOF: end of file, write'), { code: 'EOF', errno: -136 }),
        ),
    };
    await expect(writeWorkerRequest(sink, 'payload')).resolves.toBeUndefined();
  });

  test('resolves even when write() throws synchronously', async () => {
    const sink = {
      write: () => {
        throw new Error('broken pipe');
      },
      end: () => 0,
    };
    await expect(writeWorkerRequest(sink, 'payload')).resolves.toBeUndefined();
  });

  test('writes the payload and closes the sink in the normal case', async () => {
    const written: string[] = [];
    let ended = false;
    const sink = {
      write: (chunk: string) => {
        written.push(chunk);
        return chunk.length;
      },
      end: () => {
        ended = true;
        return 0;
      },
    };
    await writeWorkerRequest(sink, '{"text":"hi"}');
    expect(written).toEqual(['{"text":"hi"}']);
    expect(ended).toBe(true);
  });
});

describe('subprocess circuit breaker', () => {
  test('stops spawning after 3 consecutive worker failures and recovers via reset', async () => {
    const makeDeadProc = () =>
      ({
        stdin: { write: () => 1, end: () => 0 },
        stdout: '',
        stderr: 'worker crashed',
        exited: Promise.resolve(1),
      }) as unknown as ReturnType<typeof Bun.spawn>;

    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(makeDeadProc);
    try {
      resetEmbeddingPipeline();
      // Force the direct-import path to fail once so initPipeline falls back to
      // the subprocess route (require.resolve of the real package succeeds).
      mockCreatePipeline.mockImplementationOnce(() => Promise.reject(new Error('direct init fail')));

      for (let i = 0; i < 3; i++) {
        await expect(generateEmbedding('x')).rejects.toThrow('Embedding worker failed');
      }
      // 4th call: breaker is open — no spawn, distinct error message.
      await expect(generateEmbedding('x')).rejects.toThrow('Embedding worker unavailable');
      expect(spawnSpy).toHaveBeenCalledTimes(3);

      // resetEmbeddingPipeline() closes the breaker: spawning resumes.
      resetEmbeddingPipeline();
      mockCreatePipeline.mockImplementationOnce(() => Promise.reject(new Error('direct init fail')));
      await expect(generateEmbedding('x')).rejects.toThrow('Embedding worker failed');
      expect(spawnSpy).toHaveBeenCalledTimes(4);
    } finally {
      spawnSpy.mockRestore();
      resetEmbeddingPipeline();
    }
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
