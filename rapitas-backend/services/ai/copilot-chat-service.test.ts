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
type StoredMessage = {
  id: number;
  taskId: number | null;
  role: string;
  content: string;
  createdAt: Date;
};
type OrderBy = Partial<Record<'createdAt' | 'id', 'asc' | 'desc'>>;
type FindManyArgs = {
  where: { taskId: number };
  orderBy: OrderBy | OrderBy[];
  take?: number;
};
let storedMessages: StoredMessage[] = [];
/** Minimal in-memory findMany honoring where.taskId, orderBy (object or array) and take. */
const mockPrismaFindMany = mock((args: FindManyArgs) => {
  const orders = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
  const rows = storedMessages
    .filter((m) => m.taskId === args.where.taskId)
    .sort((a, b) => {
      for (const order of orders) {
        const [key, dir] = Object.entries(order)[0] as ['createdAt' | 'id', 'asc' | 'desc'];
        const av = key === 'createdAt' ? a.createdAt.getTime() : a.id;
        const bv = key === 'createdAt' ? b.createdAt.getTime() : b.id;
        if (av !== bv) return dir === 'asc' ? av - bv : bv - av;
      }
      return 0;
    });
  return Promise.resolve(args.take === undefined ? rows : rows.slice(0, args.take));
});
mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    copilotMessage: { create: mockPrismaCreate, findMany: mockPrismaFindMany },
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

// All four runtime exports mirrored: mock.module replaces the whole module.
mock.module('../agents/agent-knowledge-sharing', () => ({
  gatherSharedKnowledge: () => Promise.resolve({}),
  formatKnowledgeContext: () => '',
  extractMethodFromVerify: () => [],
  updatePatternsFromExecution: () => Promise.resolve(),
}));

const mockMatchCopilotIntent = mock(() => null as string | null);
const mockRespondToIntent = mock(() => Promise.resolve<string | null>(null));
mock.module('./copilot-intent-responder', () => ({
  matchCopilotIntent: mockMatchCopilotIntent,
  respondToIntent: mockRespondToIntent,
}));

const { selectModelTier, sendCopilotMessage, getCopilotHistory } =
  await import('./copilot-chat-service');

beforeEach(() => {
  storedMessages = [];
  mockPrismaFindMany.mockClear();
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

describe('getCopilotHistory — newest messages, oldest first', () => {
  const seed = (taskId: number, count: number, startId = 1) => {
    for (let i = 0; i < count; i++) {
      storedMessages.push({
        id: startId + i,
        taskId,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `m${i + 1}`,
        createdAt: new Date(Date.UTC(2026, 10, 1, 10, 0, i)),
      });
    }
  };

  it('returns the newest 50 of 60 messages in chronological order', async () => {
    seed(7, 60);
    seed(8, 5, 1000); // another task's messages never leak in

    const history = await getCopilotHistory(7);

    expect(history).toHaveLength(50);
    expect(history.map((m) => m.content)).toEqual(
      Array.from({ length: 50 }, (_, i) => `m${i + 11}`),
    );
    expect(history.at(-1)?.content).toBe('m60');
  });

  it('returns every message oldest first when there are fewer than the limit', async () => {
    seed(7, 3);

    const history = await getCopilotHistory(7);

    expect(history.map((m) => m.content)).toEqual(['m1', 'm2', 'm3']);
  });

  it('keeps insertion order (by id) for messages saved in the same instant', async () => {
    const at = new Date(Date.UTC(2026, 10, 1, 10));
    storedMessages.push(
      { id: 2, taskId: 7, role: 'assistant', content: 'answer', createdAt: at },
      { id: 1, taskId: 7, role: 'user', content: 'question', createdAt: at },
    );

    const history = await getCopilotHistory(7, 1);
    expect(history.map((m) => m.content)).toEqual(['answer']);
    expect((await getCopilotHistory(7)).map((m) => m.content)).toEqual(['question', 'answer']);
  });

  it('asks the database for the newest rows (desc) with the limit applied', async () => {
    await getCopilotHistory(7, 20);

    expect(mockPrismaFindMany).toHaveBeenCalledWith({
      where: { taskId: 7 },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
    });
  });
});
