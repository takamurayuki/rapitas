/**
 * Daily Briefing Service テスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockTask = {
  findMany: mock(() => Promise.resolve([])),
  count: mock(() => Promise.resolve(0)),
};
const mockPrisma = { task: mockTask };

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
mock.module('../../services/memory/idea-box-service', () => ({
  getUnusedIdeasForContext: mock(() => Promise.resolve([])),
}));

const mockSendAIMessage = mock(() =>
  Promise.resolve({
    content: JSON.stringify({
      greeting: 'おはようございます',
      summary: '今日のタスクは2件です',
      priorityTasks: [{ id: 1, title: 'task1', reason: 'urgent', estimatedMinutes: 30 }],
      warnings: [],
      insights: [],
      ideaSuggestion: null,
      estimatedProductiveHours: 5,
    }),
    tokensUsed: 100,
  }),
);
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: mockSendAIMessage,
}));

const { generateDailyBriefing } = await import('../../services/ai/daily-briefing-service');

describe('Daily Briefing Service', () => {
  beforeEach(() => {
    mockTask.findMany.mockReset().mockReturnValue(Promise.resolve([]));
    mockTask.count.mockReset().mockReturnValue(Promise.resolve(0));
    mockSendAIMessage.mockClear();
  });

  test('briefingを生成して構造化データを返す', async () => {
    const result = await generateDailyBriefing();

    expect(result.greeting).toBe('おはようございます');
    expect(result.summary).toContain('今日のタスク');
    expect(result.priorityTasks).toHaveLength(1);
    expect(result.estimatedProductiveHours).toBe(5);
    expect(result.date).toBeDefined();
  });

  test('カテゴリスコープを指定可能', async () => {
    await generateDailyBriefing(1);
    expect(mockTask.findMany).toHaveBeenCalled();
  });

  test('AIメッセージが呼ばれる', async () => {
    mockTask.findMany.mockReturnValue(Promise.resolve([]));
    await generateDailyBriefing();
    expect(mockSendAIMessage).toHaveBeenCalled();
  });
});
