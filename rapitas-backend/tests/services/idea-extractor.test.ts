/**
 * Idea Extractor テスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

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

mock.module('../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  }),
}));
mock.module('../../services/local-llm', () => ({
  getLocalLLMStatus: mock(() => Promise.resolve({ available: false })),
}));

const mockSubmitIdea = mock((idea: IdeaSubmission) => Promise.resolve(42));
mock.module('../../services/memory/idea-box-service', () => ({
  submitIdea: mockSubmitIdea,
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

const { extractIdeasFromExecutionLog, extractIdeasFromCopilotChat, enrichIdea } =
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
    mockSendAIMessage.mockReturnValue(
      Promise.resolve({
        content: JSON.stringify({
          actionability: 0.8,
          specificity: 0.7,
          impact: 'high',
          suggestedCategory: 'performance',
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
    expect(updateCall?.data?.category).toBe('performance');
  });
});
