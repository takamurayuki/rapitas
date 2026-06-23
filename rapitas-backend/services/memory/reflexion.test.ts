/**
 * reflectOnFailure (Reflexion) テスト
 *
 * 失敗/修復タスクから教訓を抽出し sourceType='failure_lesson' で保存すること、
 * トラブルの無いクリーン完了ではスキップすることを検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const taskFindUnique = mock(async () => ({
  id: 7,
  title: 'リファクタ: TTL集中管理',
  description: 'キャッシュTTLを定数化する。'.repeat(3),
  themeId: 1,
  theme: { categoryId: 1, category: {} },
  comments: [],
  taskLabels: [],
}));
const wfGroupBy = mock(async () => [{ cause: 'verify_repair', _count: { cause: 2 } }]);
const keFindFirst = mock(async () => null as { id: number } | null);
const keCreate = mock(async (args: { data: { sourceType: string } }) => ({
  id: 501,
  ...args.data,
}));
const sendAIMessage = mock(async () => ({
  content: JSON.stringify([
    {
      title: 'verifyの差し戻し回避',
      content: 'verify前に scoped tsc を通す',
      category: 'procedure',
    },
  ]),
}));
const enqueue = mock(async () => {});

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    task: { findUnique: taskFindUnique },
    workflowTransition: { groupBy: wfGroupBy },
    knowledgeEntry: { findFirst: keFindFirst, create: keCreate },
  },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('../../utils/ai-client', () => ({ sendAIMessage }));
mock.module('./dedup', () => ({ findSemanticDuplicate: async () => null }));
mock.module('./forgetting', () => ({ boostDecayOnAccess: async () => {} }));
mock.module('./index', () => ({ memoryTaskQueue: { enqueue } }));
mock.module('./timeline', () => ({ appendEvent: async () => {} }));
mock.module('../../config/db-provider', () => ({ getInsensitiveMode: () => 'default' }));

const { reflectOnFailure } = await import('./task-knowledge-extractor');

describe('reflectOnFailure (Reflexion)', () => {
  beforeEach(() => {
    keCreate.mockClear();
    sendAIMessage.mockClear();
    wfGroupBy.mockResolvedValue([{ cause: 'verify_repair', _count: { cause: 2 } }]);
  });

  test('失敗タスク → 教訓を failure_lesson として保存する', async () => {
    const ids = await reflectOnFailure(7, 'blocked');
    expect(sendAIMessage).toHaveBeenCalledTimes(1);
    expect(keCreate).toHaveBeenCalledTimes(1);
    expect(keCreate.mock.calls[0]![0].data.sourceType).toBe('failure_lesson');
    expect(ids).toEqual([501]);
  });

  test('トラブル無しのクリーン完了 → スキップ（LLMも呼ばない）', async () => {
    wfGroupBy.mockResolvedValue([]);
    const ids = await reflectOnFailure(7, 'completed');
    expect(sendAIMessage).not.toHaveBeenCalled();
    expect(keCreate).not.toHaveBeenCalled();
    expect(ids).toEqual([]);
  });

  test('LLMが空配列 → 何も保存しない（best-effort）', async () => {
    sendAIMessage.mockResolvedValueOnce({ content: '[]' });
    const ids = await reflectOnFailure(7, 'blocked');
    expect(keCreate).not.toHaveBeenCalled();
    expect(ids).toEqual([]);
  });
});
