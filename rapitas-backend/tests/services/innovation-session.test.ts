/**
 * Innovation Session テスト
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

interface MockTask {
  title: string;
  description: string;
  theme: { name: string };
}

const mockTask = {
  count: mock(() => Promise.resolve(0)),
  findMany: mock(() => Promise.resolve([] as MockTask[])),
};
const mockKnowledgeEntry = {
  findMany: mock(() => Promise.resolve([])),
};
const mockPrisma = { task: mockTask, knowledgeEntry: mockKnowledgeEntry };

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

const mockSubmitIdea = mock((idea: IdeaSubmission) => Promise.resolve(99));
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
      content: '[{"title":"革新案","content":"異分野からの応用"}]',
      tokensUsed: 80,
    } as AIMessageResult),
);
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: mockSendAIMessage,
}));

const { runInnovationSession } = await import('../../services/memory/innovation-session');

describe('Innovation Session', () => {
  beforeEach(() => {
    mockTask.count.mockReset().mockReturnValue(Promise.resolve(0));
    mockTask.findMany.mockReset().mockReturnValue(Promise.resolve([] as MockTask[]));
    mockKnowledgeEntry.findMany.mockReset().mockReturnValue(Promise.resolve([]));
    mockSubmitIdea.mockClear();
    mockSendAIMessage.mockReset().mockReturnValue(
      Promise.resolve({
        content: '[{"title":"革新案","content":"異分野からの応用"}]',
        tokensUsed: 80,
      } as AIMessageResult),
    );
  });

  test('完了タスクが2件未満ならスキップ', async () => {
    mockTask.count.mockReturnValue(Promise.resolve(1));
    const count = await runInnovationSession();
    expect(count).toBe(0);
    expect(mockSendAIMessage).not.toHaveBeenCalled();
  });

  test('完了タスクが2件以上で革新アイデアを生成', async () => {
    mockTask.count.mockReturnValue(Promise.resolve(5));
    mockTask.findMany.mockReturnValue(
      Promise.resolve([
        { title: 'task1', description: 'd', theme: { name: 'theme1' } },
      ] as MockTask[]),
    );
    const count = await runInnovationSession();
    expect(count).toBeGreaterThan(0);
    expect(mockSubmitIdea).toHaveBeenCalled();
  });

  test('LLMレスポンスが空ならアイデア生成しない', async () => {
    mockTask.count.mockReturnValue(Promise.resolve(5));
    mockSendAIMessage.mockReturnValue(
      Promise.resolve({ content: '[]', tokensUsed: 10 } as AIMessageResult),
    );
    const count = await runInnovationSession();
    expect(count).toBe(0);
  });

  test('source=innovation_sessionでアイデアを保存', async () => {
    mockTask.count.mockReturnValue(Promise.resolve(5));
    await runInnovationSession();
    if (mockSubmitIdea.mock.calls.length > 0) {
      const calls = mockSubmitIdea.mock.calls as Array<[IdeaSubmission]>;
      const call = calls[0]?.[0];
      expect(call?.source).toBe('innovation_session');
      expect(call?.scope).toBe('global');
    }
  });
});
