/**
 * gemini-provider.test
 *
 * Mocks `@google/generative-ai` entirely — callGemini/callGeminiStream must
 * never reach the real Gemini API. Covers history construction (system
 * filtering, last-message split), the empty-history early return, response
 * parsing, and the streaming error-formatting path.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockSendMessage = mock(() =>
  Promise.resolve({
    response: {
      text: () => 'hi from gemini',
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6 },
    },
  }),
);
const mockSendMessageStream = mock(() => Promise.resolve({ stream: fakeChunkStream([]) }));
const mockStartChat = mock((opts: unknown) => {
  capturedStartChatOpts = opts;
  return { sendMessage: mockSendMessage, sendMessageStream: mockSendMessageStream };
});
const mockGetGenerativeModel = mock((opts: unknown) => {
  capturedModelOpts = opts;
  return { startChat: mockStartChat };
});

let capturedModelOpts: unknown;
let capturedStartChatOpts: unknown;

mock.module('@google/generative-ai', () => ({
  GoogleGenerativeAI: class MockGoogleGenerativeAI {
    getGenerativeModel = mockGetGenerativeModel;
  },
}));

const { callGemini, callGeminiStream } = await import('./gemini-provider');

function fakeChunkStream(texts: string[]): AsyncIterable<{ text: () => string }> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: () => {
          if (i >= texts.length) return Promise.resolve({ done: true, value: undefined });
          const t = texts[i++]!;
          return Promise.resolve({ done: false, value: { text: () => t } });
        },
      };
    },
  };
}

beforeEach(() => {
  capturedModelOpts = undefined;
  capturedStartChatOpts = undefined;
  mockGetGenerativeModel.mockClear();
  mockStartChat.mockClear();
  mockSendMessage.mockReset().mockReturnValue(
    Promise.resolve({
      response: {
        text: () => 'hi from gemini',
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6 },
      },
    }),
  );
  mockSendMessageStream
    .mockReset()
    .mockReturnValue(Promise.resolve({ stream: fakeChunkStream([]) }));
});

describe('callGemini', () => {
  it('includes systemInstruction when a systemPrompt is given', async () => {
    await callGemini('key', 'gemini-2.5-flash', [{ role: 'user', content: 'hi' }], 'be nice', 100);
    const opts = capturedModelOpts as { systemInstruction?: { parts: Array<{ text: string }> } };
    expect(opts.systemInstruction?.parts[0]?.text).toBe('be nice');
  });

  it('omits systemInstruction when no systemPrompt is given', async () => {
    await callGemini('key', 'gemini-2.5-flash', [{ role: 'user', content: 'hi' }], undefined, 100);
    const opts = capturedModelOpts as Record<string, unknown>;
    expect('systemInstruction' in opts).toBe(false);
  });

  it('sets maxOutputTokens from the maxTokens argument', async () => {
    await callGemini('key', 'gemini-2.5-flash', [{ role: 'user', content: 'hi' }], undefined, 321);
    const opts = capturedModelOpts as { generationConfig: { maxOutputTokens: number } };
    expect(opts.generationConfig.maxOutputTokens).toBe(321);
  });

  it('filters system messages and maps assistant to model role in history', async () => {
    await callGemini(
      'key',
      'gemini-2.5-flash',
      [
        { role: 'system', content: 'ignored' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'last' },
      ],
      undefined,
      100,
    );
    const opts = capturedStartChatOpts as {
      history: Array<{ role: string; parts: Array<{ text: string }> }>;
    };
    expect(opts.history).toHaveLength(2);
    expect(opts.history[0]).toEqual({ role: 'user', parts: [{ text: 'first' }] });
    expect(opts.history[1]).toEqual({ role: 'model', parts: [{ text: 'reply' }] });
    expect(mockSendMessage).toHaveBeenCalledWith('last');
  });

  it('returns empty content without calling the API when there is no non-system message', async () => {
    const result = await callGemini(
      'key',
      'gemini-2.5-flash',
      [{ role: 'system', content: 'only system' }],
      undefined,
      100,
    );
    expect(result).toEqual({ content: '', tokensUsed: 0 });
    expect(mockStartChat).not.toHaveBeenCalled();
  });

  it('sums prompt and candidate token counts', async () => {
    const result = await callGemini(
      'key',
      'gemini-2.5-flash',
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    expect(result.content).toBe('hi from gemini');
    expect(result.tokensUsed).toBe(10);
  });

  it('defaults tokensUsed to 0 when usageMetadata is absent', async () => {
    mockSendMessage.mockReturnValue(
      Promise.resolve({ response: { text: () => 'x', usageMetadata: undefined } }),
    );
    const result = await callGemini(
      'key',
      'gemini-2.5-flash',
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    expect(result.tokensUsed).toBe(0);
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

describe('callGeminiStream', () => {
  it('emits [DONE] immediately when there is no non-system message', async () => {
    const stream = await callGeminiStream(
      'key',
      'gemini-2.5-flash',
      [{ role: 'system', content: 'only system' }],
      undefined,
      100,
    );
    const chunks = await drainStream(stream);
    expect(chunks).toEqual(['data: [DONE]\n\n']);
    expect(mockStartChat).not.toHaveBeenCalled();
  });

  it('emits an SSE chunk per non-empty text chunk then [DONE]', async () => {
    mockSendMessageStream.mockReturnValue(
      Promise.resolve({ stream: fakeChunkStream(['foo', '', 'bar']) }),
    );
    const stream = await callGeminiStream(
      'key',
      'gemini-2.5-flash',
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

  it('emits a formatted error chunk when sendMessageStream rejects', async () => {
    mockSendMessageStream.mockReturnValue(Promise.reject(new Error('429 Too Many Requests')));
    const stream = await callGeminiStream(
      'key',
      'gemini-2.5-flash',
      [{ role: 'user', content: 'hi' }],
      undefined,
      100,
    );
    const chunks = await drainStream(stream);
    expect(chunks).toHaveLength(1);
    const parsed = JSON.parse(chunks[0]!.replace('data: ', ''));
    expect(parsed.error).toContain('Gemini');
  });
});
