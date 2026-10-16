/**
 * workflow-api-callers テスト
 *
 * callAnthropicAPI / callOpenAIAPI: request shape (headers, body, optional
 * system prompt, custom endpoint) and error propagation on non-2xx.
 * decryptApiKey: real encrypt/decrypt round trip and the fallback-to-as-is
 * behavior on malformed (non-encrypted) input — no mocking needed since
 * decrypt() genuinely throws on bad input and the function's own catch
 * handles it.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { encrypt } from '../../utils/common/encryption';
import { callAnthropicAPI, callOpenAIAPI, decryptApiKey } from './workflow-api-callers';

interface StubResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

const realFetch = globalThis.fetch;
let capturedUrl = '';
let capturedInit: { method?: string; headers?: Record<string, string>; body?: string } = {};
let stubResponse: StubResponse;

beforeEach(() => {
  capturedUrl = '';
  capturedInit = {};
  stubResponse = {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
  };
  // @ts-expect-error test stub — full fetch overload surface not needed here
  globalThis.fetch = mock(async (url: string, init: typeof capturedInit) => {
    capturedUrl = url;
    capturedInit = init;
    return stubResponse;
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('callAnthropicAPI', () => {
  test('posts to the Messages endpoint with model/system/messages and the 8192 max_tokens cap', async () => {
    stubResponse.json = async () => ({ content: [{ type: 'text', text: 'hello' }] });
    const result = await callAnthropicAPI('sk-ant-xyz', 'claude-sonnet-4-5', 'be terse', 'hi');

    expect(capturedUrl).toBe('https://api.anthropic.com/v1/messages');
    expect(capturedInit.headers?.['x-api-key']).toBe('sk-ant-xyz');
    expect(capturedInit.headers?.['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(capturedInit.body ?? '{}');
    expect(body.model).toBe('claude-sonnet-4-5');
    expect(body.max_tokens).toBe(8192);
    expect(body.system).toBe('be terse');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(result).toBe('hello');
  });

  test('an empty system prompt is omitted (sent as undefined, not an empty string)', async () => {
    stubResponse.json = async () => ({ content: [] });
    await callAnthropicAPI('key', 'model', '', 'hi');
    const body = JSON.parse(capturedInit.body ?? '{}');
    expect(body.system).toBeUndefined();
  });

  test('joins multiple text blocks with newlines and drops non-text blocks', async () => {
    stubResponse.json = async () => ({
      content: [
        { type: 'text', text: 'line1' },
        { type: 'tool_use', text: 'ignored' },
        { type: 'text', text: 'line2' },
      ],
    });
    const result = await callAnthropicAPI('key', 'model', '', 'hi');
    expect(result).toBe('line1\nline2');
  });

  test('non-2xx response throws with status and body text', async () => {
    stubResponse.ok = false;
    stubResponse.status = 429;
    stubResponse.text = async () => 'rate limited';
    await expect(callAnthropicAPI('key', 'model', '', 'hi')).rejects.toThrow(
      'Anthropic API error (429): rate limited',
    );
  });
});

describe('callOpenAIAPI', () => {
  test('defaults to the public OpenAI base URL and includes a system message when provided', async () => {
    stubResponse.json = async () => ({ choices: [{ message: { content: 'answer' } }] });
    const result = await callOpenAIAPI('sk-oai', 'gpt-4o', 'sys prompt', 'question');

    expect(capturedUrl).toBe('https://api.openai.com/v1/chat/completions');
    expect(capturedInit.headers?.Authorization).toBe('Bearer sk-oai');
    const body = JSON.parse(capturedInit.body ?? '{}');
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys prompt' },
      { role: 'user', content: 'question' },
    ]);
    expect(body.max_tokens).toBe(8192);
    expect(result).toBe('answer');
  });

  test('an empty system prompt is omitted from the messages array entirely', async () => {
    stubResponse.json = async () => ({ choices: [{ message: { content: 'x' } }] });
    await callOpenAIAPI('key', 'gpt-4o', '', 'question');
    const body = JSON.parse(capturedInit.body ?? '{}');
    expect(body.messages).toEqual([{ role: 'user', content: 'question' }]);
  });

  test('a custom endpoint overrides the base URL (Azure OpenAI style)', async () => {
    stubResponse.json = async () => ({ choices: [{ message: { content: 'x' } }] });
    await callOpenAIAPI('key', 'gpt-4o', '', 'q', 'https://my-resource.openai.azure.com/v1');
    expect(capturedUrl).toBe('https://my-resource.openai.azure.com/v1/chat/completions');
  });

  test('an empty choices array falls back to an empty string rather than throwing', async () => {
    stubResponse.json = async () => ({ choices: [] });
    const result = await callOpenAIAPI('key', 'gpt-4o', '', 'q');
    expect(result).toBe('');
  });

  test('non-2xx response throws with status and body text', async () => {
    stubResponse.ok = false;
    stubResponse.status = 401;
    stubResponse.text = async () => 'invalid key';
    await expect(callOpenAIAPI('key', 'gpt-4o', '', 'q')).rejects.toThrow(
      'OpenAI API error (401): invalid key',
    );
  });
});

describe('decryptApiKey', () => {
  test('round-trips a value produced by the real encrypt() helper', async () => {
    const plaintext = 'sk-super-secret-key';
    const encrypted = encrypt(plaintext);
    expect(await decryptApiKey(encrypted)).toBe(plaintext);
  });

  test('a malformed (non-encrypted) value falls back to being returned as-is', async () => {
    // decrypt() throws "Invalid encrypted text format" for anything without
    // exactly 2 colons — decryptApiKey's catch must swallow that and return
    // the original value unchanged, treating it as an already-plain key.
    const plain = 'plain-text-api-key-not-encrypted';
    expect(await decryptApiKey(plain)).toBe(plain);
  });
});
