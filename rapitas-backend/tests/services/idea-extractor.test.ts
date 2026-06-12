/**
 * Idea Extractor テスト
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

interface IdeaSubmission {
  title: string;
  content: string;
  source?: string;
  scope?: string;
  [key: string]: unknown;
}

interface IdeaStats {
  total: number;
  unused: number;
  byCategory: Array<{ category: string; count: number }>;
}

interface IdeasListResult {
  ideas: Array<{ id: number; title: string; [key: string]: unknown }>;
  total: number;
}

interface MockKnowledgeEntry {
  id?: number;
  tags?: string;
  category?: string;
  [key: string]: unknown;
}

const mockKnowledgeEntry = {
  findUnique: mock(() => Promise.resolve(null as MockKnowledgeEntry | null)),
  update: mock((args: { where: { id: number }; data: Partial<MockKnowledgeEntry> }) =>
    Promise.resolve({} as MockKnowledgeEntry),
  ),
};
const mockPrisma = { knowledgeEntry: mockKnowledgeEntry };

// NOTE: ensureDatabaseConnection must be exported so config/index.ts re-export succeeds.
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: mock(() => Promise.resolve()),
}));

const mockLogInfo = mock(() => {});
const mockLogDebug = mock(() => {});
const mockLogWarn = mock(() => {});
const mockLogError = mock(() => {});
const mockLogger = {
  info: mockLogInfo,
  debug: mockLogDebug,
  warn: mockLogWarn,
  error: mockLogError,
};
mock.module('../../config/logger', () => ({
  logger: mockLogger,
  createLogger: () => mockLogger,
}));
mock.module('../../services/local-llm', () => ({
  getLocalLLMStatus: mock(() => Promise.resolve({ available: false })),
}));

const mockSubmitIdea = mock((idea: IdeaSubmission) => Promise.resolve(42));
const mockSubmitConcern = mock(() => Promise.resolve());
mock.module('../../services/memory/concern-backlog-service', () => ({
  submitConcern: mockSubmitConcern,
}));
mock.module('../../services/memory/idea-box-service', () => ({
  submitIdea: mockSubmitIdea,
  resolveTaskThemeId: mock(() => Promise.resolve(null)),
  getUnusedIdeasForContext: mock(() =>
    Promise.resolve([] as Array<{ id: number; title: string; content: string }>),
  ),
  markIdeaAsUsed: mock((id: number) => Promise.resolve()),
  getIdeaStats: mock((categoryId?: number) =>
    Promise.resolve({ total: 0, unused: 0, byCategory: [] } as IdeaStats),
  ),
  listIdeas: mock((opts: { categoryId?: number; limit?: number; offset?: number }) =>
    Promise.resolve({ ideas: [], total: 0 } as IdeasListResult),
  ),
}));

interface AIMessageResult {
  content: string;
  tokensUsed: number;
}

const mockSendAIMessage = mock(
  (args: { messages: Array<{ role: string; content: string }>; model?: string }) =>
    Promise.resolve({
      content: '[{"title":"改善案","content":"具体的な内容"}]',
      tokensUsed: 50,
    } as AIMessageResult),
);
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: mockSendAIMessage,
}));

const { extractIdeasFromExecutionLog, extractIdeasFromCopilotChat, enrichIdea, reviewIdea, runEnrichAndReview } =
  await import('../../services/memory/idea-extractor');

describe('Idea Extractor', () => {
  beforeEach(() => {
    mockKnowledgeEntry.findUnique
      .mockReset()
      .mockReturnValue(Promise.resolve(null as MockKnowledgeEntry | null));
    mockKnowledgeEntry.update
      .mockReset()
      .mockReturnValue(Promise.resolve({} as MockKnowledgeEntry));
    mockSubmitIdea.mockClear();
    mockLogInfo.mockClear();
    mockLogDebug.mockClear();
    mockLogWarn.mockClear();
    mockSendAIMessage.mockReset().mockReturnValue(
      Promise.resolve({
        content: '[{"title":"改善案","content":"具体的な内容"}]',
        tokensUsed: 50,
      } as AIMessageResult),
    );
  });

  test('実行ログからアイデアを抽出', async () => {
    const ids = await extractIdeasFromExecutionLog(1, 'verify content');
    expect(ids.length).toBeGreaterThan(0);
    expect(mockSubmitIdea).toHaveBeenCalled();
  });

  test('コンテンツが空の場合は空配列を返す', async () => {
    const ids = await extractIdeasFromExecutionLog(1, '');
    expect(ids).toHaveLength(0);
  });

  test('コパイロット会話からアイデアを抽出（5件以上）', async () => {
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = Array.from(
      { length: 6 },
      (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `message ${i}`,
      }),
    );
    const ids = await extractIdeasFromCopilotChat(history);
    expect(ids.length).toBeGreaterThan(0);
  });

  test('短すぎる会話ではアイデア抽出スキップ', async () => {
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: 'short' },
    ];
    const ids = await extractIdeasFromCopilotChat(history);
    expect(ids).toHaveLength(0);
  });

  test('enrichIdeaでconfidenceとカテゴリを更新', async () => {
    // NOTE: 'feature' is a valid idea category (not in CONCERN_CATEGORY_MAP),
    // so it should update the knowledgeEntry rather than reclassifying to concern.
    mockSendAIMessage.mockReturnValue(
      Promise.resolve({
        content: JSON.stringify({
          actionability: 0.8,
          specificity: 0.7,
          impact: 'high',
          suggestedCategory: 'feature',
        }),
        tokensUsed: 30,
      } as AIMessageResult),
    );
    mockKnowledgeEntry.findUnique.mockReturnValue(
      Promise.resolve({ tags: '[]' } as MockKnowledgeEntry),
    );

    await enrichIdea(1, 'タイトル', 'コンテンツ');

    expect(mockKnowledgeEntry.update).toHaveBeenCalled();
    const calls = mockKnowledgeEntry.update.mock.calls as Array<
      [{ where: { id: number }; data: Partial<MockKnowledgeEntry> }]
    >;
    const updateCall = calls[0]?.[0];
    expect(updateCall?.data?.category).toBe('feature');
  });
});

describe('Idea Extractor — structured logging', () => {
  beforeEach(() => {
    mockKnowledgeEntry.findUnique
      .mockReset()
      .mockReturnValue(Promise.resolve({ tags: '[]' } as MockKnowledgeEntry));
    mockKnowledgeEntry.update
      .mockReset()
      .mockReturnValue(Promise.resolve({} as MockKnowledgeEntry));
    mockLogInfo.mockClear();
    mockLogWarn.mockClear();
    mockSendAIMessage.mockReset().mockReturnValue(
      Promise.resolve({
        content: JSON.stringify({ actionability: 0.8, specificity: 0.7, impact: 'high', suggestedCategory: 'improvement' }),
        tokensUsed: 30,
      } as AIMessageResult),
    );
  });

  test('enrichIdea 成功時に durationMs と ideaId を log.info で出力する', async () => {
    await enrichIdea(42, 'タイトル', 'コンテンツ');

    const infoCalls = mockLogInfo.mock.calls as Array<[Record<string, unknown>, string]>;
    const enrichedCall = infoCalls.find(([fields]) => fields?.ideaId === 42);
    expect(enrichedCall).toBeDefined();
    expect(typeof enrichedCall?.[0]?.durationMs).toBe('number');
    expect(enrichedCall?.[1]).toBe('Idea enriched');
  });

  test('enrichIdea runId オプション指定時に runId がログに含まれる', async () => {
    const runId = 'test-run-id-123';
    await enrichIdea(42, 'タイトル', 'コンテンツ', { runId });

    const infoCalls = mockLogInfo.mock.calls as Array<[Record<string, unknown>, string]>;
    const enrichedCall = infoCalls.find(([fields]) => fields?.ideaId === 42 && fields?.runId === runId);
    expect(enrichedCall).toBeDefined();
    expect(enrichedCall?.[0]?.runId).toBe(runId);
  });

  test('enrichIdea 失敗時に durationMs を log.warn で出力する', async () => {
    mockSendAIMessage.mockRejectedValue(new Error('LLM error'));

    await enrichIdea(99, 'タイトル', 'コンテンツ');

    const warnCalls = mockLogWarn.mock.calls as Array<[Record<string, unknown>, string]>;
    const failCall = warnCalls.find(([fields]) => fields?.ideaId === 99);
    expect(failCall).toBeDefined();
    expect(typeof failCall?.[0]?.durationMs).toBe('number');
    expect(failCall?.[1]).toBe('Idea enrichment failed');
  });

  test('reviewIdea 成功時に durationMs と feasible を log.info で出力する', async () => {
    mockKnowledgeEntry.findUnique.mockReturnValue(
      Promise.resolve({ title: 'T', content: 'C', tags: '[]', sourceId: 'agent' } as MockKnowledgeEntry),
    );
    mockSendAIMessage.mockReturnValue(
      Promise.resolve({
        content: JSON.stringify({ feasible: true, benefits: ['速い'], risks: [], reviewNote: 'OK' }),
        tokensUsed: 40,
      } as AIMessageResult),
    );
    mockKnowledgeEntry.findUnique
      .mockReturnValueOnce(Promise.resolve({ title: 'T', content: 'C', tags: '[]', sourceId: 'agent' } as MockKnowledgeEntry))
      .mockReturnValue(Promise.resolve({ tags: '[]' } as MockKnowledgeEntry));

    await reviewIdea(77);

    const infoCalls = mockLogInfo.mock.calls as Array<[Record<string, unknown>, string]>;
    const reviewCall = infoCalls.find(([fields]) => fields?.ideaId === 77);
    expect(reviewCall).toBeDefined();
    expect(typeof reviewCall?.[0]?.durationMs).toBe('number');
    expect(reviewCall?.[0]?.feasible).toBe(true);
  });

  test('reviewIdea runId 引数指定時に runId がログに含まれる', async () => {
    const runId = 'review-run-id-456';
    mockKnowledgeEntry.findUnique
      .mockReturnValueOnce(Promise.resolve({ title: 'T', content: 'C', tags: '[]', sourceId: 'agent' } as MockKnowledgeEntry))
      .mockReturnValue(Promise.resolve({ tags: '[]' } as MockKnowledgeEntry));
    mockSendAIMessage.mockReturnValue(
      Promise.resolve({
        content: JSON.stringify({ feasible: true, benefits: [], risks: [] }),
        tokensUsed: 40,
      } as AIMessageResult),
    );

    await reviewIdea(88, runId);

    const infoCalls = mockLogInfo.mock.calls as Array<[Record<string, unknown>, string]>;
    const reviewCall = infoCalls.find(([fields]) => fields?.ideaId === 88 && fields?.runId === runId);
    expect(reviewCall).toBeDefined();
  });

  test('runEnrichAndReview は enrichChain: start を log.info で出力する', async () => {
    runEnrichAndReview(55, 'テスト', 'コンテンツ');

    // start ログは同期的に出力される
    const infoCalls = mockLogInfo.mock.calls as Array<[Record<string, unknown>, string]>;
    const startCall = infoCalls.find(([, msg]) => msg === 'enrichChain: start');
    expect(startCall).toBeDefined();
    expect(typeof startCall?.[0]?.runId).toBe('string');
    expect(startCall?.[0]?.ideaId).toBe(55);
  });

  test('runEnrichAndReview は完了後に enrichChain: complete を log.info で出力する', async () => {
    // Flush all pending microtasks after calling runEnrichAndReview
    runEnrichAndReview(66, 'テスト', 'コンテンツ');
    await new Promise((r) => setTimeout(r, 10));

    const infoCalls = mockLogInfo.mock.calls as Array<[Record<string, unknown>, string]>;
    const completeCall = infoCalls.find(([, msg]) => msg === 'enrichChain: complete');
    expect(completeCall).toBeDefined();
    expect(typeof completeCall?.[0]?.durationMs).toBe('number');
    expect(typeof completeCall?.[0]?.llmCallCount).toBe('number');
    expect(completeCall?.[0]?.outcome).toBe('success');
  });
});
