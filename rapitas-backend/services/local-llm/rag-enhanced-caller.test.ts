import { describe, test, expect, mock } from 'bun:test';

const mockSendAIMessage = mock(() => Promise.resolve({ content: 'reply', tokensUsed: 1 }));
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: mockSendAIMessage,
}));

const mockBuildRAGContext = mock(() =>
  Promise.resolve({ query: '', entries: [] as unknown[], contextText: '' }),
);
mock.module('../memory/rag/context-builder', () => ({
  buildRAGContext: mockBuildRAGContext,
}));

mock.module('../../config', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

const { sendRAGEnhancedMessage } = await import('./rag-enhanced-caller');

describe('sendRAGEnhancedMessage', () => {
  test('injects RAG context into the system prompt when entries are found', async () => {
    mockBuildRAGContext.mockResolvedValueOnce({
      query: 'hi',
      entries: [{ id: 1 }, { id: 2 }],
      contextText: 'relevant knowledge',
    });
    mockSendAIMessage.mockClear();

    const result = await sendRAGEnhancedMessage({
      messages: [{ role: 'user', content: 'hi' }],
      systemPrompt: 'base prompt',
    });

    expect(result.ragEntriesUsed).toBe(2);
    const callArg = mockSendAIMessage.mock.calls[0][0];
    expect(callArg.systemPrompt).toContain('relevant knowledge');
    expect(callArg.systemPrompt).toContain('base prompt');
  });

  test('does not modify the system prompt when no RAG entries are found', async () => {
    mockBuildRAGContext.mockResolvedValueOnce({ query: 'hi', entries: [], contextText: '' });
    mockSendAIMessage.mockClear();

    await sendRAGEnhancedMessage({
      messages: [{ role: 'user', content: 'hi' }],
      systemPrompt: 'base prompt',
    });

    const callArg = mockSendAIMessage.mock.calls[0][0];
    expect(callArg.systemPrompt).toBe('base prompt');
  });

  test('skips RAG entirely when enableRAG is false', async () => {
    mockBuildRAGContext.mockClear();
    mockSendAIMessage.mockClear();

    await sendRAGEnhancedMessage({
      messages: [{ role: 'user', content: 'hi' }],
      enableRAG: false,
    });

    expect(mockBuildRAGContext).not.toHaveBeenCalled();
    expect(mockSendAIMessage.mock.calls[0][0].systemPrompt).toBe('');
  });

  test('extracts the query from the last user message when ragQuery is omitted', async () => {
    mockBuildRAGContext.mockResolvedValueOnce({ query: '', entries: [], contextText: '' });
    mockBuildRAGContext.mockClear();

    await sendRAGEnhancedMessage({
      messages: [
        { role: 'assistant', content: 'earlier reply' },
        { role: 'user', content: 'the real question' },
      ],
    });

    expect(mockBuildRAGContext).toHaveBeenCalledWith(
      'the real question',
      expect.objectContaining({ limit: 3, minSimilarity: 0.5 }),
    );
  });

  test('uses an explicit ragQuery over extraction from messages', async () => {
    mockBuildRAGContext.mockResolvedValueOnce({ query: '', entries: [], contextText: '' });
    mockBuildRAGContext.mockClear();

    await sendRAGEnhancedMessage({
      messages: [{ role: 'user', content: 'ignored message' }],
      ragQuery: 'explicit query',
    });

    expect(mockBuildRAGContext).toHaveBeenCalledWith('explicit query', expect.anything());
  });

  test('skips RAG when there is no user message and no explicit ragQuery', async () => {
    mockBuildRAGContext.mockClear();

    await sendRAGEnhancedMessage({
      messages: [{ role: 'assistant', content: 'only assistant messages' }],
    });

    expect(mockBuildRAGContext).not.toHaveBeenCalled();
  });

  test('degrades gracefully (still calls sendAIMessage) when buildRAGContext throws', async () => {
    mockBuildRAGContext.mockImplementationOnce(() => Promise.reject(new Error('rag failure')));
    mockSendAIMessage.mockClear();

    const result = await sendRAGEnhancedMessage({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.ragEntriesUsed).toBe(0);
    expect(mockSendAIMessage).toHaveBeenCalledTimes(1);
  });

  test('passes ragLimit/ragMinSimilarity/ragThemeId through to buildRAGContext', async () => {
    mockBuildRAGContext.mockResolvedValueOnce({ query: '', entries: [], contextText: '' });
    mockBuildRAGContext.mockClear();

    await sendRAGEnhancedMessage({
      messages: [{ role: 'user', content: 'hi' }],
      ragLimit: 7,
      ragMinSimilarity: 0.8,
      ragThemeId: 42,
    });

    expect(mockBuildRAGContext).toHaveBeenCalledWith(
      'hi',
      expect.objectContaining({ limit: 7, minSimilarity: 0.8, themeId: 42 }),
    );
  });

  test('returns the underlying AIResponse fields alongside ragEntriesUsed', async () => {
    mockSendAIMessage.mockResolvedValueOnce({ content: 'specific reply', tokensUsed: 99 });
    const result = await sendRAGEnhancedMessage({
      messages: [{ role: 'user', content: 'hi' }],
      enableRAG: false,
    });
    expect(result.content).toBe('specific reply');
    expect(result.tokensUsed).toBe(99);
  });
});
