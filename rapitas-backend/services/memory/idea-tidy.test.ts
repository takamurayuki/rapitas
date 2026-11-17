/**
 * idea-tidy.test
 *
 * 「アイデアを整理して」 went to the task tidy (2026-11-17): ラピ had no way to
 * tidy the idea box. What she proposes: near-duplicates gathered under the
 * one to keep, and ideas no longer needed (already turned into a task, or
 * old and low priority). Nothing changes until the person confirms, and an
 * applied tidy can be undone.
 */
import { describe, expect, mock, test, beforeEach } from 'bun:test';

const updates: Array<{ where: { id: number }; data: Record<string, unknown> }> = [];
const updateMany = mock(async (_: unknown) => ({ count: 0 }));
let rows: Array<Record<string, unknown>> = [];
mock.module('../../config/database', () => ({
  prisma: {
    knowledgeEntry: {
      findMany: mock(async () => rows),
      update: mock(async (args: { where: { id: number }; data: Record<string, unknown> }) => {
        updates.push(args);
        return {};
      }),
      updateMany,
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        knowledgeEntry: {
          update: async (args: { where: { id: number }; data: Record<string, unknown> }) => {
            updates.push(args);
            return {};
          },
          updateMany,
        },
      }),
  },
}));

const { planIdeaTidy, applyIdeaTidy, undoIdeaTidy } = await import('./idea-tidy');

const NOW = new Date('2026-11-17T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const idea = (
  id: number,
  title: string,
  over: Partial<Parameters<typeof planIdeaTidy>[0][number]> = {},
) => ({
  id,
  title,
  content: `${title} の内容`,
  priority: 'medium' as const,
  used: false,
  createdAt: daysAgo(1),
  ...over,
});

beforeEach(() => {
  updates.length = 0;
  updateMany.mockClear();
});

describe('what she proposes', () => {
  test('near-duplicates are gathered under the one to keep', () => {
    const plan = planIdeaTidy(
      [
        idea(1, 'タスク一覧に検索ボックスを付ける'),
        idea(2, 'タスク一覧に検索ボックスを付けたい', { priority: 'high' }),
        idea(3, 'ダークモードの配色を見直す'),
      ],
      NOW,
    );
    expect(plan.duplicates).toHaveLength(1);
    // The higher priority one is kept.
    expect(plan.duplicates[0].keepId).toBe(2);
    expect(plan.duplicates[0].ideas.map((i) => i.id).sort()).toEqual([1, 2]);
  });

  test('ideas already turned into a task, and old low-priority ones, are offered to put away', () => {
    const plan = planIdeaTidy(
      [
        idea(1, '通知を減らす', { used: true }),
        idea(2, '古い思いつき', { priority: 'low', createdAt: daysAgo(120) }),
        idea(3, '新しい低優先の思いつき', { priority: 'low', createdAt: daysAgo(5) }),
        idea(4, '古いが高優先', { priority: 'high', createdAt: daysAgo(200) }),
      ],
      NOW,
    );
    expect(plan.unneeded.map((u) => [u.id, u.reason])).toEqual([
      [1, 'used'],
      [2, 'stale'],
    ]);
  });

  test('an idea in a duplicate group is not offered twice', () => {
    const plan = planIdeaTidy(
      [
        idea(1, 'ログの警告を減らす', { priority: 'low', createdAt: daysAgo(120) }),
        idea(2, 'ログの警告を減らしたい'),
      ],
      NOW,
    );
    expect(plan.duplicates).toHaveLength(1);
    expect(plan.unneeded).toEqual([]);
  });
});

describe('applying and undoing', () => {
  test('merged ideas are archived and named in the kept one; put-away ideas are archived', async () => {
    rows = [
      { id: 2, title: '検索ボックスを付けたい', content: '本文2' },
      { id: 1, title: '検索ボックスを付ける', content: '本文1' },
    ];
    const done = await applyIdeaTidy({ merges: [{ keepId: 2, mergeIds: [1] }], archiveIds: [9] });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 9] }, sourceType: 'idea_box' },
      data: { forgettingStage: 'archived' },
    });
    const kept = updates.find((u) => u.where.id === 2);
    expect(String(kept?.data.content)).toContain('本文2');
    expect(String(kept?.data.content)).toContain('検索ボックスを付ける');
    expect(done.archivedIds.sort()).toEqual([1, 9]);
    expect(done.previousContents).toEqual([{ id: 2, content: '本文2' }]);
  });

  test('undo brings the archived ideas back and restores the kept text', async () => {
    await undoIdeaTidy({ archivedIds: [1, 9], previousContents: [{ id: 2, content: '本文2' }] });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 9] }, sourceType: 'idea_box' },
      data: { forgettingStage: 'active' },
    });
    expect(updates.find((u) => u.where.id === 2)?.data.content).toBe('本文2');
  });
});
