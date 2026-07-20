/**
 * blocked-cause ユニットテスト
 *
 * attachBlockedCauses の分岐（空配列・非ブロック混在・ネストされたサブタスク・
 * 複数トランジション行の重複排除）を検証する。prisma は関数引数として渡される
 * ため mock.module は不要 — プレーンなモックオブジェクトを直接渡す。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';
import { attachBlockedCauses, type TaskLikeForBlockedCause } from './blocked-cause';

type FindManyArgs = {
  where: { taskId: { in: number[] } };
  orderBy: { createdAt: 'desc' };
  select: { taskId: boolean; cause: boolean };
};

const findMany = mock(() => Promise.resolve([])) as ReturnType<typeof mock>;

function buildPrisma(): PrismaClient {
  return {
    workflowTransition: { findMany },
  } as unknown as PrismaClient;
}

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([]);
});

describe('attachBlockedCauses', () => {
  test('空配列を渡した場合 → DBに問い合わせず空配列を返すこと', async () => {
    const result = await attachBlockedCauses(buildPrisma(), []);

    expect(result).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  test('ブロック中タスクが1件も無い場合 → DBに問い合わせず元の配列を返すこと', async () => {
    const tasks: TaskLikeForBlockedCause[] = [
      { id: 1, status: 'todo' },
      { id: 2, status: 'done' },
    ];

    const result = await attachBlockedCauses(buildPrisma(), tasks);

    expect(result).toBe(tasks);
    expect(findMany).not.toHaveBeenCalled();
  });

  test('ブロック中タスク1件 → 最新の cause が blockedCause に設定されること', async () => {
    findMany.mockResolvedValueOnce([{ taskId: 1, cause: 'waiting_for_approval' }]);
    const tasks: TaskLikeForBlockedCause[] = [{ id: 1, status: 'blocked' }];

    const result = await attachBlockedCauses(buildPrisma(), tasks);

    expect(result[0].blockedCause).toBe('waiting_for_approval');
  });

  test('同一タスクに複数のトランジション行がある場合 → 配列の先頭行(最新順)を採用すること', async () => {
    findMany.mockResolvedValueOnce([
      { taskId: 1, cause: 'newest_cause' },
      { taskId: 1, cause: 'older_cause' },
    ]);
    const tasks: TaskLikeForBlockedCause[] = [{ id: 1, status: 'blocked' }];

    const result = await attachBlockedCauses(buildPrisma(), tasks);

    expect(result[0].blockedCause).toBe('newest_cause');
  });

  test('該当するトランジション行が無いブロック中タスク → blockedCause が null になること', async () => {
    findMany.mockResolvedValueOnce([]);
    const tasks: TaskLikeForBlockedCause[] = [{ id: 1, status: 'blocked' }];

    const result = await attachBlockedCauses(buildPrisma(), tasks);

    expect(result[0].blockedCause).toBeNull();
  });

  test('非ブロック中タスクの blockedCause は変更されないこと', async () => {
    findMany.mockResolvedValueOnce([]);
    const tasks: TaskLikeForBlockedCause[] = [
      { id: 1, status: 'todo', blockedCause: 'stale_value' },
    ];

    const result = await attachBlockedCauses(buildPrisma(), tasks);

    expect(result[0].blockedCause).toBe('stale_value');
  });

  test('ネストされたサブタスクのブロック原因も再帰的に収集・付与されること', async () => {
    findMany.mockResolvedValueOnce([
      { taskId: 10, cause: 'parent_cause' },
      { taskId: 11, cause: 'child_cause' },
    ]);
    const tasks: TaskLikeForBlockedCause[] = [
      {
        id: 10,
        status: 'blocked',
        subtasks: [
          { id: 11, status: 'blocked' },
          { id: 12, status: 'todo' },
        ],
      },
    ];

    const result = await attachBlockedCauses(buildPrisma(), tasks);

    expect(result[0].blockedCause).toBe('parent_cause');
    expect(result[0].subtasks?.[0].blockedCause).toBe('child_cause');
    expect(result[0].subtasks?.[1].blockedCause).toBeUndefined();
  });

  test('非ブロック中の親の下にブロック中サブタスクがある場合 → サブタスクにのみ付与されること', async () => {
    findMany.mockResolvedValueOnce([{ taskId: 21, cause: 'sub_cause' }]);
    const tasks: TaskLikeForBlockedCause[] = [
      {
        id: 20,
        status: 'todo',
        subtasks: [{ id: 21, status: 'blocked' }],
      },
    ];

    const result = await attachBlockedCauses(buildPrisma(), tasks);

    expect(result[0].blockedCause).toBeUndefined();
    expect(result[0].subtasks?.[0].blockedCause).toBe('sub_cause');
  });

  test('空のサブタスク配列は再帰対象にならないこと（findMany の対象IDに影響しない）', async () => {
    const tasks: TaskLikeForBlockedCause[] = [{ id: 30, status: 'todo', subtasks: [] }];

    const result = await attachBlockedCauses(buildPrisma(), tasks);

    expect(result).toBe(tasks);
    expect(findMany).not.toHaveBeenCalled();
  });

  test('findMany が正しい where/orderBy/select で呼ばれること', async () => {
    findMany.mockResolvedValueOnce([]);
    const tasks: TaskLikeForBlockedCause[] = [
      { id: 1, status: 'blocked' },
      { id: 2, status: 'blocked', subtasks: [{ id: 3, status: 'blocked' }] },
    ];

    await attachBlockedCauses(buildPrisma(), tasks);

    expect(findMany).toHaveBeenCalledTimes(1);
    const callArgs = findMany.mock.calls[0][0] as FindManyArgs;
    expect(callArgs.where.taskId.in).toEqual([1, 2, 3]);
    expect(callArgs.orderBy).toEqual({ createdAt: 'desc' });
    expect(callArgs.select).toEqual({ taskId: true, cause: true });
  });

  test('戻り値は入力と同一の配列参照であること（インプレース変更）', async () => {
    findMany.mockResolvedValueOnce([{ taskId: 1, cause: 'x' }]);
    const tasks: TaskLikeForBlockedCause[] = [{ id: 1, status: 'blocked' }];

    const result = await attachBlockedCauses(buildPrisma(), tasks);

    expect(result).toBe(tasks);
  });
});
