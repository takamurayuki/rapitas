/**
 * copilot-chat-service.test
 *
 * Unit test for the widened local-LLM routing threshold (selectModelTier),
 * plus an integration-style test locking that sendCopilotMessage's
 * deterministic intent shortcut (Step 0) returns without ever calling the
 * LLM cascade, and that non-matching messages still fall through to it.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockPrismaCreate = mock(() => Promise.resolve({}));
const mockTaskFindUnique = mock(() => Promise.resolve<Record<string, unknown> | null>(null));
mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    copilotMessage: { create: mockPrismaCreate },
    task: { findUnique: mockTaskFindUnique },
  },
}));

const mockGetLocalLLMStatus = mock(() => Promise.resolve({ available: false }));
mock.module('../local-llm', () => ({ getLocalLLMStatus: mockGetLocalLLMStatus }));

mock.module('../local-llm/local-model-selector', () => ({
  pickBestLocalModel: () => 'llama3.2',
}));

const mockGetCachedResponse = mock(() => null as { content: string; tokensUsed: number } | null);
const mockSetCachedResponse = mock(() => {});
mock.module('../local-llm/response-cache', () => ({
  getCachedResponse: mockGetCachedResponse,
  setCachedResponse: mockSetCachedResponse,
  generateCacheKey: () => 'cache-key',
}));

const mockSendAIMessage = mock(() => Promise.resolve({ content: 'llm answer', tokensUsed: 10 }));
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: mockSendAIMessage,
  sendAIMessageStream: mock(() => Promise.resolve(new ReadableStream())),
}));

mock.module('../agents/agent-knowledge-sharing', () => ({
  gatherSharedKnowledge: () => Promise.resolve({}),
  formatKnowledgeContext: () => '',
}));

const mockMatchCopilotIntent = mock(() => null as string | null);
const mockRespondToIntent = mock(() => Promise.resolve<string | null>(null));
mock.module('./copilot-intent-responder', () => ({
  matchCopilotIntent: mockMatchCopilotIntent,
  respondToIntent: mockRespondToIntent,
}));

const { selectModelTier, sendCopilotMessage } = await import('./copilot-chat-service');

beforeEach(() => {
  mockPrismaCreate.mockReset().mockResolvedValue({});
  mockTaskFindUnique.mockReset().mockResolvedValue(null);
  mockGetLocalLLMStatus.mockReset().mockResolvedValue({ available: false });
  mockGetCachedResponse.mockReset().mockReturnValue(null);
  mockSendAIMessage.mockReset().mockResolvedValue({ content: 'llm answer', tokensUsed: 10 });
  mockMatchCopilotIntent.mockReset().mockReturnValue(null);
  mockRespondToIntent.mockReset().mockResolvedValue(null);
});

describe('selectModelTier — widened local-LLM eligibility', () => {
  it('routes an ordinary short conversational question to the free local tier', () => {
    // Regression: previously gated on assessComplexity's canUseLocalLLM,
    // which requires level==='low' — an ordinary short chat message only
    // ever reached 'medium' (score 40), so this branch almost never fired.
    const result = selectModelTier('このタスクの状況を教えて', true);
    expect(result).toEqual({ provider: 'ollama', model: 'llama3.2', tier: 'free' });
  });

  it.each([
    [
      'a message containing a high-complexity keyword, even when short',
      'このセキュリティの実装は大丈夫？',
      true,
    ],
    ['a message at/over the 400-char cap, even when otherwise simple', 'あ'.repeat(400), true],
    [
      'an ordinary short message when the local LLM is unavailable',
      'このタスクの状況を教えて',
      false,
    ],
  ])('routes %s to Claude', (_label, message, localAvailable) => {
    const result = selectModelTier(message, localAvailable);
    expect(result.provider).toBe('claude');
  });
});

describe('sendCopilotMessage — Step 0 deterministic intent shortcut', () => {
  it('returns the template answer directly without touching the LLM cascade', async () => {
    mockMatchCopilotIntent.mockReturnValue('status_priority');
    mockRespondToIntent.mockResolvedValue('現在のステータスは「進行中」、優先度は「高」です。');

    const result = await sendCopilotMessage({ message: 'ステータスは？', taskId: 1 });

    expect(result).toEqual({
      content: '現在のステータスは「進行中」、優先度は「高」です。',
      model: 'template',
      tier: 'free',
      cached: false,
    });
    expect(mockSendAIMessage).not.toHaveBeenCalled();
    expect(mockGetCachedResponse).not.toHaveBeenCalled();
  });

  it('falls through to the normal cascade when the message matches no intent', async () => {
    mockMatchCopilotIntent.mockReturnValue(null);

    const result = await sendCopilotMessage({ message: '実装方針についてどう思う？', taskId: 1 });

    expect(result.model).not.toBe('template');
    expect(mockSendAIMessage).toHaveBeenCalledTimes(1);
  });

  it('falls through to the normal cascade when an intent matches but the DB has nothing to say', async () => {
    mockMatchCopilotIntent.mockReturnValue('due_estimate');
    mockRespondToIntent.mockResolvedValue(null);

    const result = await sendCopilotMessage({ message: '期限は？', taskId: 1 });

    expect(result.model).not.toBe('template');
    expect(mockSendAIMessage).toHaveBeenCalledTimes(1);
  });

  it('skips the intent shortcut entirely when there is no taskId', async () => {
    await sendCopilotMessage({ message: 'ステータスは？' });
    expect(mockMatchCopilotIntent).not.toHaveBeenCalled();
  });
});
