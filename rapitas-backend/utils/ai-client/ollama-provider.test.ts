/**
 * ollama-provider.test
 *
 * Locks the local-LLM determinism guarantee: every outbound inference request
 * carries the fixed seed AND temperature 0, on both the llama-server
 * (OpenAI-compatible) and the Ollama-native (/api/chat) code paths.
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

// Mock the logger module fully — provide BOTH the createLogger factory and the
// `logger` singleton so any importer of either export resolves.
const noopLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLog,
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLog,
  logger: noopLog,
}));

const { callOllama, callOllamaStream, checkOllamaConnection } = await import('./ollama-provider');

const okResponse = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [{ message: { content: 'hi' } }],
    usage: { total_tokens: 3 },
    message: { content: 'hi' },
    eval_count: 1,
    prompt_eval_count: 2,
  }),
  text: async () => '',
});

let capturedBodies: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  capturedBodies = [];
  // @ts-expect-error test stub
  globalThis.fetch = mock(async (_url: string, init: { body: string }) => {
    capturedBodies.push(init.body);
    return okResponse();
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('callOllama — deterministic request body', () => {
  it('llama-server path pins seed=42 and temperature=0', async () => {
    await callOllama('http://localhost:8922', 'test-model', [{ role: 'user', content: 'q' }]);
    expect(capturedBodies).toHaveLength(1);
    const body = JSON.parse(capturedBodies[0]!);
    expect(body.seed).toBe(42);
    expect(body.temperature).toBe(0);
  });

  it('ollama-native path pins options.seed=42 and options.temperature=0', async () => {
    await callOllama('http://localhost:11434', 'test-model', [{ role: 'user', content: 'q' }]);
    expect(capturedBodies).toHaveLength(1);
    const body = JSON.parse(capturedBodies[0]!);
    expect(body.options.seed).toBe(42);
    expect(body.options.temperature).toBe(0);
  });
});

describe('callOllama — response parsing', () => {
  it('extracts content and tokensUsed from the llama-server (OpenAI-shaped) response', async () => {
    // @ts-expect-error test stub
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'llama-server reply' } }],
        usage: { total_tokens: 12 },
      }),
      text: async () => '',
    }));
    const result = await callOllama('http://localhost:8922', 'm', [{ role: 'user', content: 'q' }]);
    expect(result).toEqual({ content: 'llama-server reply', tokensUsed: 12 });
  });

  it('extracts content and sums eval_count+prompt_eval_count for the ollama-native response', async () => {
    // @ts-expect-error test stub
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        message: { content: 'ollama reply' },
        eval_count: 5,
        prompt_eval_count: 3,
      }),
      text: async () => '',
    }));
    const result = await callOllama('http://localhost:11434', 'm', [
      { role: 'user', content: 'q' },
    ]);
    expect(result).toEqual({ content: 'ollama reply', tokensUsed: 8 });
  });

  it('includes a system message first when systemPrompt is provided', async () => {
    // @ts-expect-error test stub
    globalThis.fetch = mock(async (_url: string, init: { body: string }) => {
      capturedBodies.push(init.body);
      return okResponse();
    });
    await callOllama('http://localhost:11434', 'm', [{ role: 'user', content: 'q' }], 'be nice');
    const body = JSON.parse(capturedBodies[0]!);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be nice' });
  });

  it('throws when the response body has no extractable content', async () => {
    // @ts-expect-error test stub
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
      text: async () => '',
    }));
    await expect(
      callOllama('http://localhost:8922', 'm', [{ role: 'user', content: 'q' }]),
    ).rejects.toThrow('Local LLM returned empty response');
  });

  it('throws with the response body text on a non-503 error status', async () => {
    // @ts-expect-error test stub
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'internal error',
    }));
    await expect(
      callOllama('http://localhost:8922', 'm', [{ role: 'user', content: 'q' }]),
    ).rejects.toThrow('Local LLM API error (500): internal error');
  });
});

describe('checkOllamaConnection', () => {
  it('reports connected via the ollama /api/tags endpoint when it responds ok', async () => {
    // @ts-expect-error test stub
    globalThis.fetch = mock(async (url: string) => {
      if (url.endsWith('/api/tags')) {
        return {
          ok: true,
          json: async () => ({ models: [{ name: 'qwen2.5:0.5b' }, { name: 'llama3' }] }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });
    const result = await checkOllamaConnection('http://localhost:11434');
    expect(result).toEqual({
      connected: true,
      models: ['qwen2.5:0.5b', 'llama3'],
      serverType: 'ollama',
    });
  });

  it('falls back to llama-server /v1/models when /api/tags is unavailable', async () => {
    // @ts-expect-error test stub
    globalThis.fetch = mock(async (url: string) => {
      if (url.endsWith('/api/tags')) throw new Error('connection refused');
      if (url.endsWith('/v1/models')) {
        return { ok: true, json: async () => ({ data: [{ id: 'qwen2.5-0.5b-instruct' }] }) };
      }
      return { ok: false, json: async () => ({}) };
    });
    const result = await checkOllamaConnection('http://localhost:8922');
    expect(result).toEqual({
      connected: true,
      models: ['qwen2.5-0.5b-instruct'],
      serverType: 'llama-server',
    });
  });

  it('reports disconnected with an error message when neither endpoint responds', async () => {
    // @ts-expect-error test stub
    globalThis.fetch = mock(async () => {
      throw new Error('econnrefused');
    });
    const result = await checkOllamaConnection('http://localhost:9999');
    expect(result.connected).toBe(false);
    expect(result.serverType).toBe('unknown');
    expect(result.error).toContain('http://localhost:9999');
  });
});

describe('callOllamaStream', () => {
  it('decodes SSE "data:" chunks and enqueues the delta content', async () => {
    const encoder = new TextEncoder();
    const sseChunk = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n';
    // @ts-expect-error test stub
    globalThis.fetch = mock(async () => ({
      ok: true,
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: async () => {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: encoder.encode(sseChunk) };
            },
          };
        },
      },
    }));

    const stream = await callOllamaStream('http://localhost:8922', 'm', [
      { role: 'user', content: 'q' },
    ]);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let out = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value);
    }
    expect(out).toBe('Hello');
  });

  it('throws when the response is not ok', async () => {
    // @ts-expect-error test stub
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 503,
      text: async () => 'loading',
    }));
    await expect(
      callOllamaStream('http://localhost:8922', 'm', [{ role: 'user', content: 'q' }]),
    ).rejects.toThrow('Local LLM API error (503): loading');
  });

  it('throws when the response has no body', async () => {
    // @ts-expect-error test stub
    globalThis.fetch = mock(async () => ({ ok: true, body: null }));
    await expect(
      callOllamaStream('http://localhost:8922', 'm', [{ role: 'user', content: 'q' }]),
    ).rejects.toThrow('Local LLM returned no stream body');
  });
});
