/**
 * task-frequency-suggestions ユニットテスト
 *
 * getFrequencyBasedSuggestions の頻度集計・既存タスク除外・ソート・件数制限
 * ロジックを検証する。prisma は関数引数として渡されるため mock.module は不要。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';
import { getFrequencyBasedSuggestions } from './task-frequency-suggestions';

interface FakeCompletedTask {
  id: number;
  title: string;
  description: string | null;
  priority: string;
  estimatedHours: number | null;
  completedAt: Date | null;
  taskLabels?: { labelId: number }[];
}

const findMany = mock(() => Promise.resolve([])) as ReturnType<typeof mock>;

function buildPrisma(): PrismaClient {
  return {
    task: { findMany },
  } as unknown as PrismaClient;
}

function completedTask(
  overrides: Partial<FakeCompletedTask> & { title: string },
): FakeCompletedTask {
  return {
    id: 1,
    description: null,
    priority: 'medium',
    estimatedHours: null,
    completedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/** Queues the two sequential findMany calls (completed tasks, then active tasks). */
function queueResults(completed: FakeCompletedTask[], existing: { title: string }[] = []) {
  findMany.mockResolvedValueOnce(completed).mockResolvedValueOnce(existing);
}

beforeEach(() => {
  findMany.mockReset();
});

describe('getFrequencyBasedSuggestions', () => {
  test('完了タスクが無い場合 → 空配列を返すこと', async () => {
    queueResults([]);

    const result = await getFrequencyBasedSuggestions(buildPrisma(), 1, 10);

    expect(result).toEqual([]);
  });

  test('タイトルが重複しない完了タスク → 各1件ずつ frequency=1 で返ること', async () => {
    queueResults([
      completedTask({ id: 1, title: 'タスクA' }),
      completedTask({ id: 2, title: 'タスクB' }),
    ]);

    const result = await getFrequencyBasedSuggestions(buildPrisma(), 1, 10);

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.frequency === 1)).toBe(true);
  });

  test('同一タイトルが複数回完了している場合 → 頻度が集計されること', async () => {
    queueResults([
      completedTask({ id: 1, title: '定例レビュー' }),
      completedTask({ id: 2, title: '定例レビュー' }),
      completedTask({ id: 3, title: '定例レビュー' }),
    ]);

    const result = await getFrequencyBasedSuggestions(buildPrisma(), 1, 10);

    expect(result).toHaveLength(1);
    expect(result[0].frequency).toBe(3);
  });

  test('タイトルの大文字小文字・前後空白を無視して同一タイトルとして集計すること', async () => {
    queueResults([
      completedTask({ id: 1, title: 'Deploy' }),
      completedTask({ id: 2, title: '  deploy  ' }),
      completedTask({ id: 3, title: 'DEPLOY' }),
    ]);

    const result = await getFrequencyBasedSuggestions(buildPrisma(), 1, 10);

    expect(result).toHaveLength(1);
    expect(result[0].frequency).toBe(3);
    expect(result[0].title).toBe('Deploy');
  });

  test('既にアクティブ(todo/in-progress)な同名タスクがある場合 → 提案から除外されること', async () => {
    queueResults(
      [
        completedTask({ id: 1, title: '定例レビュー' }),
        completedTask({ id: 2, title: '新規タスク' }),
      ],
      [{ title: '定例レビュー' }],
    );

    const result = await getFrequencyBasedSuggestions(buildPrisma(), 1, 10);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('新規タスク');
  });

  test('既存タイトルの除外判定も大文字小文字・空白を無視すること', async () => {
    queueResults([completedTask({ id: 1, title: 'Deploy App' })], [{ title: '  DEPLOY APP  ' }]);

    const result = await getFrequencyBasedSuggestions(buildPrisma(), 1, 10);

    expect(result).toEqual([]);
  });

  test('頻度が高い順にソートされること', async () => {
    queueResults([
      completedTask({ id: 1, title: '低頻度' }),
      completedTask({ id: 2, title: '高頻度' }),
      completedTask({ id: 3, title: '高頻度' }),
      completedTask({ id: 4, title: '高頻度' }),
    ]);

    const result = await getFrequencyBasedSuggestions(buildPrisma(), 1, 10);

    expect(result[0].title).toBe('高頻度');
    expect(result[0].frequency).toBe(3);
    expect(result[1].title).toBe('低頻度');
  });

  test('頻度が同じ場合 → completedAt が新しい順にソートされること', async () => {
    queueResults([
      completedTask({ id: 1, title: '古い方', completedAt: new Date('2026-01-01') }),
      completedTask({ id: 2, title: '新しい方', completedAt: new Date('2026-02-01') }),
    ]);

    const result = await getFrequencyBasedSuggestions(buildPrisma(), 1, 10);

    expect(result[0].title).toBe('新しい方');
    expect(result[1].title).toBe('古い方');
  });

  test('completedAt が null の場合 → 例外を投げずソート時刻を 0 として扱うこと', async () => {
    queueResults([
      completedTask({ id: 1, title: 'null日時', completedAt: null }),
      completedTask({ id: 2, title: '通常日時', completedAt: new Date('2026-01-01') }),
    ]);

    const result = await getFrequencyBasedSuggestions(buildPrisma(), 1, 10);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('通常日時');
  });

  test('limit を超える件数がある場合 → limit 件に切り詰められること', async () => {
    queueResults([
      completedTask({ id: 1, title: 'A' }),
      completedTask({ id: 2, title: 'B' }),
      completedTask({ id: 3, title: 'C' }),
    ]);

    const result = await getFrequencyBasedSuggestions(buildPrisma(), 1, 2);

    expect(result).toHaveLength(2);
  });

  test('taskLabels が無い場合 → labelIds は空配列になること', async () => {
    queueResults([completedTask({ id: 1, title: 'ラベル無し', taskLabels: undefined })]);

    const result = await getFrequencyBasedSuggestions(buildPrisma(), 1, 10);

    expect(result[0].labelIds).toEqual([]);
  });

  test('taskLabels がある場合 → labelId の配列にマッピングされること', async () => {
    queueResults([
      completedTask({
        id: 1,
        title: 'ラベル付き',
        taskLabels: [{ labelId: 5 }, { labelId: 7 }],
      }),
    ]);

    const result = await getFrequencyBasedSuggestions(buildPrisma(), 1, 10);

    expect(result[0].labelIds).toEqual([5, 7]);
  });

  test('戻り値の各項目に priority / estimatedHours / description が反映されること', async () => {
    queueResults([
      completedTask({
        id: 1,
        title: '詳細確認',
        priority: 'high',
        estimatedHours: 3.5,
        description: '説明文',
      }),
    ]);

    const result = await getFrequencyBasedSuggestions(buildPrisma(), 1, 10);

    expect(result[0]).toMatchObject({
      title: '詳細確認',
      priority: 'high',
      estimatedHours: 3.5,
      description: '説明文',
      frequency: 1,
    });
  });

  test('findMany が themeId・parentId: null・status: done で完了タスクを問い合わせること', async () => {
    queueResults([]);

    await getFrequencyBasedSuggestions(buildPrisma(), 99, 10);

    const firstCallArgs = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(firstCallArgs.where).toEqual({ themeId: 99, parentId: null, status: 'done' });
  });

  test('findMany が themeId・parentId: null・status in [todo, in-progress] でアクティブタスクを問い合わせること', async () => {
    queueResults([]);

    await getFrequencyBasedSuggestions(buildPrisma(), 99, 10);

    const secondCallArgs = findMany.mock.calls[1][0] as { where: Record<string, unknown> };
    expect(secondCallArgs.where).toEqual({
      themeId: 99,
      parentId: null,
      status: { in: ['todo', 'in-progress'] },
    });
  });
});
