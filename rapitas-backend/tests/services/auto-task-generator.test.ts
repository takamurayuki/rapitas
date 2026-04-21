/**
 * Auto Task Generator テスト
 * auto-task-generator.ts のビジネスロジックのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockTask = {
  findMany: mock(() => Promise.resolve([])),
  count: mock(() => Promise.resolve(0)),
  create: mock(() => Promise.resolve({ id: 1 })),
};

const mockTheme = {
  findMany: mock(() => Promise.resolve([])),
};

const mockKnowledgeEntry = {
  findMany: mock(() => Promise.resolve([])),
  findFirst: mock(() => Promise.resolve(null)),
  update: mock(() => Promise.resolve({})),
};

const mockPrisma = {
  task: mockTask,
  theme: mockTheme,
  knowledgeEntry: mockKnowledgeEntry,
};

mock.module('../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  }),
}));
mock.module('../../utils/ai-client', () => ({
  getApiKeyForProvider: mock(() => Promise.resolve('test-key')),
}));
mock.module('../../services/memory/idea-box-service', () => ({
  getUnusedIdeasForContext: mock(() => Promise.resolve([])),
  markIdeaAsUsed: mock(() => Promise.resolve()),
}));

// Mock Anthropic SDK
const mockCreate = mock(() =>
  Promise.resolve({
    content: [{ type: 'text', text: '[]' }],
  }),
);
mock.module('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

const { autoGenerateTasks } = await import('../../services/ai/auto-task-generator');

describe('Auto Task Generator', () => {
  beforeEach(() => {
    mockTask.count.mockReset().mockReturnValue(Promise.resolve(0));
    mockTask.findMany.mockReset().mockReturnValue(Promise.resolve([]));
    mockTask.create.mockReset().mockReturnValue(Promise.resolve({ id: 1 }));
    mockTheme.findMany.mockReset().mockReturnValue(Promise.resolve([]));
    mockCreate.mockReset().mockReturnValue(
      Promise.resolve({ content: [{ type: 'text', text: '[]' }] }),
    );
  });

  describe('閾値チェック', () => {
    test('完了タスク10件未満でinsufficient返却', async () => {
      mockTask.count.mockReturnValue(Promise.resolve(5));

      const result = await autoGenerateTasks({ categoryId: 1 });

      expect(result.insufficientData).toBe(true);
      expect(result.completedTaskCount).toBe(5);
      expect(result.generatedTasks).toHaveLength(0);
    });

    test('force=trueで閾値スキップ', async () => {
      mockTask.count.mockReturnValue(Promise.resolve(3));
      mockCreate.mockReturnValue(
        Promise.resolve({
          content: [{ type: 'text', text: '[{"title":"test","description":"desc","priority":"medium","reasoning":"reason"}]' }],
        }),
      );

      const result = await autoGenerateTasks({ categoryId: 1, force: true });

      expect(result.insufficientData).toBeUndefined();
      expect(result.generatedTasks).toHaveLength(1);
    });

    test('10件以上で正常実行', async () => {
      mockTask.count.mockReturnValue(Promise.resolve(15));
      mockCreate.mockReturnValue(
        Promise.resolve({
          content: [{ type: 'text', text: '[{"title":"task1","description":"desc","priority":"high","reasoning":"reason"}]' }],
        }),
      );

      const result = await autoGenerateTasks({});

      expect(result.insufficientData).toBeUndefined();
      expect(result.generatedTasks).toHaveLength(1);
      expect(mockTask.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('タスク生成', () => {
    test('autoExecuteフラグが正しく設定される', async () => {
      mockTask.count.mockReturnValue(Promise.resolve(20));
      mockCreate.mockReturnValue(
        Promise.resolve({
          content: [{ type: 'text', text: '[{"title":"t","description":"d","priority":"medium","reasoning":"r"}]' }],
        }),
      );

      await autoGenerateTasks({ autoExecute: true });

      const createCall = mockTask.create.mock.calls[0][0];
      expect(createCall.data.autoExecutable).toBe(true);
      expect(createCall.data.agentGenerated).toBe(true);
    });

    test('空のレスポンスを正しくハンドル', async () => {
      mockTask.count.mockReturnValue(Promise.resolve(20));
      mockCreate.mockReturnValue(
        Promise.resolve({ content: [{ type: 'text', text: '[]' }] }),
      );

      const result = await autoGenerateTasks({});

      expect(result.generatedTasks).toHaveLength(0);
      expect(mockTask.create).not.toHaveBeenCalled();
    });
  });
});
