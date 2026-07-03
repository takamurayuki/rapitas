/**
 * chatgpt-provider.test
 *
 * Mocks the `openai` SDK entirely — callChatGPT/callChatGPTStream must never
 * reach the real OpenAI API. Covers request-shape branches (system prompt
 * presence, multi-message history), response parsing (missing content/usage),
 * and the streaming error-formatting path.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockCreate = mock(() =>
  Promise.resolve({
    choices: [{ message: { content: 'hello from gpt' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }),
);

mock.module('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

const { callChatGPT, callChatGPTStream } = await import('./chatgpt-provider');

beforeEach(() => {
  mockCreate.mockReset().mockReturnValue(
    Promise.resolve({
      choices: [{ message: { content: 'hello from gpt' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
  );
});

describe('callChatGPT', () => {
  it('prepends the system message when a systemPrompt is given', async () => {
    await callChatGPT('key', 'gpt-4o', [{ role: 'user', content: 'hi' }], 'be nice', 100);
    const args = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ role: string }> };
    expect(args.messages[0]).toEqual({ role: 'system', content: 'be nice' });
    expect(args.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('omits the system message when no systemPrompt is given', async () => {
    await callChatGPT('key', 'gpt-4o', [{ role: 'user', content: 'hi' }], undefined, 100);
    const args = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ role: string }> };
    expect(args.messages).toHaveLength(1);
    expect(args.messages[0]?.role).toBe('user');
  });

  it('forwards model and max_tokens', async () => {
    await callChatGPT('key', 'gpt-4o-mini', [{ role: 'user', content: 'hi' }], undefined, 256);
    const args = mockCreate.mock.calls[0]?.[0] as { model: string; max_tokens: number };
    expect(args.model).toBe('gpt-4o-mini');
    expect(args.max_tokens).toBe(256);
  });

  it('sums prompt and completion tokens', async () => {
    const result = await callChatGPT(
      'key',
      'gpt-4o',
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    expect(result.content).toBe('hello from gpt');
    expect(result.tokensUsed).toBe(15);
  });

  it('falls back to empty content and 0 tokens when the response has none', async () => {
    mockCreate.mockReturnValue(Promise.resolve({ choices: [{ message: {} }], usage: undefined }));
    const result = await callChatGPT(
      'key',
      'gpt-4o',
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    expect(result.content).toBe('');
    expect(result.tokensUsed).toBe(0);
  });

  it('falls back to empty content when choices is empty', async () => {
    mockCreate.mockReturnValue(Promise.resolve({ choices: [], usage: {} }));
    const result = await callChatGPT(
      'key',
      'gpt-4o',
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    expect(result.content).toBe('');
  });
});

async function drainStream(stream: ReadableStream): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }
  return chunks;
}

function fakeChunkStream(
  contents: Array<string | undefined>,
): AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: () => {
          if (i >= contents.length) return Promise.resolve({ done: true, value: undefined });
          const content = contents[i++];
          return Promise.resolve({ done: false, value: { choices: [{ delta: { content } }] } });
        },
      };
    },
  };
}

describe('callChatGPTStream', () => {
  it('emits an SSE chunk per non-empty delta then [DONE]', async () => {
    mockCreate.mockReturnValue(Promise.resolve(fakeChunkStream(['foo', undefined, 'bar'])));
    const stream = await callChatGPTStream(
      'key',
      'gpt-4o',
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    const chunks = await drainStream(stream);
    expect(chunks).toHaveLength(3);
    expect(JSON.parse(chunks[0]!.replace('data: ', ''))).toEqual({ content: 'foo' });
    expect(JSON.parse(chunks[1]!.replace('data: ', ''))).toEqual({ content: 'bar' });
    expect(chunks[2]).toBe('data: [DONE]\n\n');
  });

  it('passes stream: true and includes the system prompt', async () => {
    mockCreate.mockReturnValue(Promise.resolve(fakeChunkStream([])));
    await callChatGPTStream('key', 'gpt-4o', [{ role: 'user', content: 'hi' }], 'sys', 100);
    const args = mockCreate.mock.calls[0]?.[0] as {
      stream: boolean;
      messages: Array<{ role: string }>;
    };
    expect(args.stream).toBe(true);
    expect(args.messages[0]?.role).toBe('system');
  });

  it('emits a formatted error chunk when the SDK call rejects', async () => {
    mockCreate.mockReturnValue(Promise.reject(new Error('invalid api key')));
    const stream = await callChatGPTStream(
      'key',
      'gpt-4o',
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    const chunks = await drainStream(stream);
    expect(chunks).toHaveLength(1);
    const parsed = JSON.parse(chunks[0]!.replace('data: ', ''));
    expect(parsed.error).toContain('OpenAI');
  });
});
