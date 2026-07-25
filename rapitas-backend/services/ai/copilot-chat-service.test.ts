/**
 * copilot-chat-service.test
 *
 * Unit tests for selectModelTier's Haiku/Sonnet complexity split (no local
 * LLM — Ollama was dropped for unreliable summarization quality), plus an
 * integration-style test locking that sendCopilotMessage's deterministic
 * intent shortcut (Step 0) returns without ever calling the LLM, and that
 * non-matching messages still fall through to Claude.
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
  mockGetCachedResponse.mockReset().mockReturnValue(null);
  mockSendAIMessage.mockReset().mockResolvedValue({ content: 'llm answer', tokensUsed: 10 });
  mockMatchCopilotIntent.mockReset().mockReturnValue(null);
  mockRespondToIntent.mockReset().mockResolvedValue(null);
});

describe('selectModelTier — Claude-only complexity split (no local LLM)', () => {
  it('routes an ordinary short conversational question to Haiku', () => {
    const result = selectModelTier('このタスクの状況を教えて');
    expect(result).toEqual({ model: 'claude-haiku-4-5-20251001', tier: 'economy' });
  });

  it('routes a message with multiple high-complexity keywords to Sonnet', () => {
    // Two matches are needed to actually cross the 'high' score cutoff (a
    // single match plus the short-message penalty nets to 'medium') — see
    // assessComplexity's scoring.
    const result = selectModelTier('このセキュリティとアーキテクチャの設計は大丈夫？');
    expect(result).toEqual({ model: 'claude-sonnet-4-6', tier: 'standard' });
  });

  it('never returns a non-Claude provider or a "free"/local tier', () => {
    const result = selectModelTier('あ'.repeat(500));
    expect(result.tier).not.toBe('free');
    expect(['economy', 'standard']).toContain(result.tier);
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

  it('falls through to Claude when the message matches no intent', async () => {
    mockMatchCopilotIntent.mockReturnValue(null);

    const result = await sendCopilotMessage({ message: '実装方針についてどう思う？', taskId: 1 });

    expect(result.model).not.toBe('template');
    expect(mockSendAIMessage).toHaveBeenCalledTimes(1);
    expect(mockSendAIMessage.mock.calls[0][0]).toMatchObject({ provider: 'claude' });
  });

  it('falls through to Claude when an intent matches but the DB has nothing to say', async () => {
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
