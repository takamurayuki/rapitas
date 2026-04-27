/**
 * IdeaBox Service テスト
 * idea-box-service.ts のビジネスロジックのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockKnowledgeEntry = {
  findFirst: mock(() => Promise.resolve(null)),
  findMany: mock(() => Promise.resolve([])),
  create: mock(() => Promise.resolve({ id: 1 })),
  update: mock(() => Promise.resolve({})),
  count: mock(() => Promise.resolve(0)),
  groupBy: mock(() => Promise.resolve([])),
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
mock.module('../../services/memory/utils', () => ({
  createContentHash: mock(() => 'test-hash'),
}));

const service = await import('../../services/memory/idea-box-service');
const { submitIdea, listIdeas, markIdeaAsUsed, getIdeaStats } = service;

describe('IdeaBox Service', () => {
  beforeEach(() => {
    mockKnowledgeEntry.findFirst.mockReset().mockReturnValue(Promise.resolve(null));
    mockKnowledgeEntry.findMany.mockReset().mockReturnValue(Promise.resolve([]));
    mockKnowledgeEntry.create.mockReset().mockReturnValue(Promise.resolve({ id: 42 }));
    mockKnowledgeEntry.update.mockReset().mockReturnValue(Promise.resolve({}));
    mockKnowledgeEntry.count.mockReset().mockReturnValue(Promise.resolve(0));
    mockKnowledgeEntry.groupBy.mockReset().mockReturnValue(Promise.resolve([]));
  });

  describe('submitIdea', () => {
    test('新規アイデアを正常に登録', async () => {
      const id = await submitIdea({ title: 'テスト改善', content: 'テストカバレッジを上げる' });

      expect(id).toBe(42);
      expect(mockKnowledgeEntry.create).toHaveBeenCalledTimes(1);
      const call = mockKnowledgeEntry.create.mock.calls[0][0];
      expect(call.data.sourceType).toBe('idea_box');
      expect(call.data.title).toBe('テスト改善');
    });

    test('重複アイデアをスキップ', async () => {
      mockKnowledgeEntry.findFirst.mockReturnValue(Promise.resolve({ id: 99 }));

      const id = await submitIdea({ title: '重複', content: '同じ内容' });

      expect(id).toBe(99);
      expect(mockKnowledgeEntry.create).not.toHaveBeenCalled();
    });

    test('カテゴリとタグが正しく保存される', async () => {
      await submitIdea({
        title: 'UX改善',
        content: 'ボタンを大きくする',
        category: 'ux',
        tags: ['ui', 'button'],
      });

      const call = mockKnowledgeEntry.create.mock.calls[0][0];
      expect(call.data.category).toBe('ux');
      expect(call.data.tags).toBe('["ui","button"]');
    });
  });

  describe('listIdeas', () => {
    test('ページネーション付きでアイデアを取得', async () => {
      mockKnowledgeEntry.findMany.mockReturnValue(
        Promise.resolve([
          {
            id: 1,
            title: 'idea1',
            content: 'c',
            category: 'improvement',
            tags: '[]',
            confidence: 0.7,
            themeId: null,
            taskId: null,
            sourceId: 'user',
            createdAt: new Date(),
          },
        ]),
      );
      mockKnowledgeEntry.count.mockReturnValue(Promise.resolve(1));

      const result = await listIdeas({ limit: 10, offset: 0 });

      expect(result.total).toBe(1);
      expect(result.ideas).toHaveLength(1);
      expect(result.ideas[0].title).toBe('idea1');
    });

    test('未使用フィルタが適用される', async () => {
      await listIdeas({ unusedOnly: true });

      const call = mockKnowledgeEntry.findMany.mock.calls[0][0];
      expect(call.where.NOT).toBeDefined();
    });
  });

  describe('markIdeaAsUsed', () => {
    test('sourceIdがused_task_形式で更新される', async () => {
      await markIdeaAsUsed(42, 100);

      expect(mockKnowledgeEntry.update).toHaveBeenCalledTimes(1);
      const call = mockKnowledgeEntry.update.mock.calls[0][0];
      expect(call.where.id).toBe(42);
      expect(call.data.sourceId).toBe('used_task_100');
    });
  });

  describe('getIdeaStats', () => {
    test('統計情報を返す', async () => {
      mockKnowledgeEntry.count
        .mockReturnValueOnce(Promise.resolve(10))
        .mockReturnValueOnce(Promise.resolve(7));
      mockKnowledgeEntry.groupBy.mockReturnValue(
        Promise.resolve([
          { category: 'improvement', _count: { id: 5 } },
          { category: 'bug_noticed', _count: { id: 3 } },
        ]),
      );

      const stats = await getIdeaStats();

      expect(stats.total).toBe(10);
      expect(stats.unused).toBe(7);
      expect(stats.byCategory).toHaveLength(2);
    });
  });
});
