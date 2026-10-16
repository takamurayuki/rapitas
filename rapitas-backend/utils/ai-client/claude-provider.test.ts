/**
 * claude-provider.test
 *
 * Mocks the `@anthropic-ai/sdk` entirely — callClaude/callClaudeStream must
 * never reach the real Anthropic API. Also mocks `setTimeout` so the retry
 * backoff (up to 8s per attempt) does not slow the test run down.
 * Covers system-message extraction, retry-on-529/429/5xx, retry exhaustion,
 * non-retryable immediate throw, and the streaming error-formatting path.
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

const noopLog = {
  info: () => {},
  warn: mock(() => {}),
  error: () => {},
  debug: () => {},
  child: () => noopLog,
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLog,
  logger: noopLog,
  getBackendLogFilePath: () => '/tmp/fake.log',
}));

const mockCreate = mock(() =>
  Promise.resolve({
    content: [{ type: 'text', text: 'hi from claude' }],
    usage: { input_tokens: 7, output_tokens: 3 },
  }),
);
const mockStream = mock(() => fakeEventStream([]));

mock.module('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate, stream: mockStream };
  },
}));

const { callClaude, callClaudeStream } = await import('./claude-provider');

function fakeEventStream(
  events: Array<{ type: string; delta?: { type: string; text?: string } }>,
): AsyncIterable<{ type: string; delta?: { type: string; text?: string } }> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: () => {
          if (i >= events.length) return Promise.resolve({ done: true, value: undefined });
          return Promise.resolve({ done: false, value: events[i++] });
        },
      };
    },
  };
}

const realSetTimeout = globalThis.setTimeout;

beforeEach(() => {
  mockCreate.mockReset().mockReturnValue(
    Promise.resolve({
      content: [{ type: 'text', text: 'hi from claude' }],
      usage: { input_tokens: 7, output_tokens: 3 },
    }),
  );
  mockStream.mockReset().mockReturnValue(fakeEventStream([]));
  noopLog.warn.mockReset();
  // Retry backoff uses real timers (1s-8s); fire immediately so tests stay fast.
  // @ts-expect-error test stub — signature-compatible enough for this call site
  globalThis.setTimeout = (fn: () => void) => {
    fn();
    return 0;
  };
});

afterEach(() => {
  globalThis.setTimeout = realSetTimeout;
});

describe('callClaude', () => {
  it('filters system-role messages out of the chat history', async () => {
    await callClaude(
      'key',
      'claude-3',
      [
        { role: 'system', content: 'ignored' },
        { role: 'user', content: 'hi' },
      ],
      undefined,
      100,
    );
    const args = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ role: string }> };
    expect(args.messages).toHaveLength(1);
    expect(args.messages[0]?.role).toBe('user');
  });

  it('prefers the explicit systemPrompt over an embedded system message', async () => {
    await callClaude(
      'key',
      'claude-3',
      [
        { role: 'system', content: 'embedded' },
        { role: 'user', content: 'hi' },
      ],
      'explicit',
      100,
    );
    const args = mockCreate.mock.calls[0]?.[0] as { system?: string };
    expect(args.system).toBe('explicit');
  });

  it('falls back to an embedded system message when no systemPrompt is given', async () => {
    await callClaude(
      'key',
      'claude-3',
      [
        { role: 'system', content: 'embedded' },
        { role: 'user', content: 'hi' },
      ],
      undefined,
      100,
    );
    const args = mockCreate.mock.calls[0]?.[0] as { system?: string };
    expect(args.system).toBe('embedded');
  });

  it('omits the system field entirely when none is available', async () => {
    await callClaude('key', 'claude-3', [{ role: 'user', content: 'hi' }], undefined, 100);
    const args = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect('system' in args).toBe(false);
  });

  it('extracts the first text block and sums input/output tokens', async () => {
    const result = await callClaude(
      'key',
      'claude-3',
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    expect(result.content).toBe('hi from claude');
    expect(result.tokensUsed).toBe(10);
  });

  it('returns empty content when no text block is present', async () => {
    mockCreate.mockReturnValue(Promise.resolve({ content: [{ type: 'image' }], usage: undefined }));
    const result = await callClaude(
      'key',
      'claude-3',
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    expect(result.content).toBe('');
    expect(result.tokensUsed).toBe(0);
  });

  it('throws immediately on a non-retryable error', async () => {
    mockCreate.mockReturnValue(
      Promise.reject(Object.assign(new Error('bad request'), { status: 400 })),
    );
    await expect(
      callClaude('key', 'claude-3', [{ role: 'user', content: 'hi' }], undefined, 100),
    ).rejects.toThrow('bad request');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: '529 overloaded', status: 529, message: 'overloaded' },
    { label: '429 rate-limit', status: 429, message: 'rate limited' },
    { label: 'generic 5xx', status: 503, message: 'server error' },
  ])(
    'retries on a $label error and succeeds on the second attempt',
    async ({ status, message }) => {
      let calls = 0;
      mockCreate.mockImplementation(() => {
        calls++;
        if (calls === 1) return Promise.reject(Object.assign(new Error(message), { status }));
        return Promise.resolve({ content: [{ type: 'text', text: 'ok' }], usage: {} });
      });
      const result = await callClaude(
        'key',
        'claude-3',
        [{ role: 'user', content: 'hi' }],
        undefined,
        100,
      );
      expect(result.content).toBe('ok');
      expect(calls).toBe(2);
      expect(noopLog.warn).toHaveBeenCalledTimes(1);
    },
  );

  it('throws the last error once retries are exhausted', async () => {
    mockCreate.mockReturnValue(
      Promise.reject(Object.assign(new Error('still overloaded'), { status: 529 })),
    );
    await expect(
      callClaude('key', 'claude-3', [{ role: 'user', content: 'hi' }], undefined, 100),
    ).rejects.toThrow('still overloaded');
    expect(mockCreate).toHaveBeenCalledTimes(4);
    expect(noopLog.warn).toHaveBeenCalledTimes(3);
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

describe('callClaudeStream', () => {
  it('emits an SSE chunk for each text delta then [DONE]', async () => {
    mockStream.mockReturnValue(
      fakeEventStream([
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'foo' } },
        { type: 'content_block_delta', delta: { type: 'input_json_delta' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'bar' } },
        { type: 'message_stop' },
      ]),
    );
    const stream = await callClaudeStream(
      'key',
      'claude-3',
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

  it('emits a formatted error chunk when the stream throws', async () => {
    mockStream.mockImplementation(() => {
      throw new Error('invalid x-api-key');
    });
    const stream = await callClaudeStream(
      'key',
      'claude-3',
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    const chunks = await drainStream(stream);
    expect(chunks).toHaveLength(1);
    const parsed = JSON.parse(chunks[0]!.replace('data: ', ''));
    expect(parsed.error).toContain('Claude');
  });
});
