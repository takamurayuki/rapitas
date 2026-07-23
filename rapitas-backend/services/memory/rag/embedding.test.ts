import { describe, test, expect, mock, spyOn } from 'bun:test';

// Mock @xenova/transformers so tests never load the real (slow, ~100MB)
// ML model or hit this repo's known-broken subprocess fallback (missing
// sharp native binding in this environment — see project history).
const defaultPipelineImpl = () =>
  Promise.resolve((text: string) => {
    // Deterministic "embedding": a fixed-length vector derived from text length,
    // just needs to be a Float32Array-like shape for the real code to consume.
    const data = new Float32Array(4).fill(text.length / 100);
    return Promise.resolve({ data });
  });
const mockCreatePipeline = mock(defaultPipelineImpl);
mock.module('@xenova/transformers', () => ({
  pipeline: mockCreatePipeline,
}));
// NOTE: full mirror of config/logger exports — bun's mock.module is
// process-global, so a partial mirror breaks unrelated test files.
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
  logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, fatal: () => {} },
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

describe('writeWorkerRequest', () => {
  test('resolves when end() returns an EOF-style rejection (dead pipe)', async () => {
    const sink = {
      write: () => 1,
      end: () =>
        Promise.reject(
          Object.assign(new Error('EOF: end of file, write'), {
            code: 'EOF',
            syscall: 'write',
            errno: -136,
          }),
        ),
    };
    await expect(writeWorkerRequest(sink, '{"text":"x"}')).resolves.toBeUndefined();
  });

  test('resolves when write() throws synchronously', async () => {
    const sink = {
      write: () => {
        throw new Error('dead pipe');
      },
      end: () => 0,
    };
    await expect(writeWorkerRequest(sink, '{"text":"x"}')).resolves.toBeUndefined();
  });

  test('writes the payload then ends the sink in the normal case', async () => {
    const writes: string[] = [];
    let ended = false;
    const sink = {
      write: (chunk: string) => {
        writes.push(chunk);
        return chunk.length;
      },
      end: () => {
        ended = true;
        return 0;
      },
    };
    await writeWorkerRequest(sink, '{"text":"ok"}');
    expect(writes).toEqual(['{"text":"ok"}']);
    expect(ended).toBe(true);
  });
});

describe('subprocess circuit breaker', () => {
  test('stops spawning after 3 consecutive failures and re-arms via resetEmbeddingPipeline', async () => {
    // Force the direct-init path to fail so the subprocess fallback is taken.
    mockCreatePipeline.mockImplementation(() =>
      Promise.reject(new Error('forced direct-init failure')),
    );
    const makeFakeProc = () =>
      ({
        stdin: {
          write: () => {
            throw new Error('dead pipe');
          },
          end: () => 0,
        },
        stdout: '',
        stderr: 'worker crashed (fake)',
        exited: Promise.resolve(1),
      }) as unknown as ReturnType<typeof Bun.spawn>;
    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => makeFakeProc());
    try {
      resetEmbeddingPipeline();
      for (let i = 0; i < 4; i++) {
        await expect(generateEmbedding('x')).rejects.toThrow();
      }
      // 4th call must not spawn: the breaker is open after 3 consecutive failures.
      expect(spawnSpy).toHaveBeenCalledTimes(3);
      await expect(generateEmbedding('x')).rejects.toThrow(
        /unavailable after 3 consecutive failures/,
      );
      expect(spawnSpy).toHaveBeenCalledTimes(3);

      // Reset re-arms the breaker: the next call spawns again.
      resetEmbeddingPipeline();
      await expect(generateEmbedding('x')).rejects.toThrow();
      expect(spawnSpy).toHaveBeenCalledTimes(4);
    } finally {
      spawnSpy.mockRestore();
      mockCreatePipeline.mockImplementation(defaultPipelineImpl);
      resetEmbeddingPipeline();
    }
  });
});
