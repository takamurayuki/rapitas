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

const { callOllama } = await import('./ollama-provider');

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
