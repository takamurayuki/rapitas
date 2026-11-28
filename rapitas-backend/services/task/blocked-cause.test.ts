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
    expect(callArgs.select).toEqual({ taskId: true, cause: true, metadata: true });
  });

  const causeOf = async (rows: Array<{ cause: string; metadata?: string }>) => {
    findMany.mockResolvedValueOnce(rows.map((row) => ({ taskId: 1, ...row })));
    const tasks: TaskLikeForBlockedCause[] = [{ id: 1, status: 'blocked' }];
    const [task] = await attachBlockedCauses(buildPrisma(), tasks);
    return task.blockedCause;
  };
  const stopped = {
    cause: 'verification_stopped',
    metadata: JSON.stringify({ failedChecks: ['scope', 'runtime'] }),
  };

  test('検査で止まった場合 → 検査名を付けて返すこと', async () => {
    expect(await causeOf([stopped])).toBe('verification_stopped:scope,runtime');
  });

  test('検査不能の保留 → unverifiableChecks の検査名を付けて返すこと', async () => {
    const hold = {
      cause: 'verification_unverifiable_hold',
      metadata: JSON.stringify({ unverifiableChecks: ['runtime'] }),
    };

    expect(await causeOf([hold])).toBe('verification_unverifiable_hold:runtime');
  });

  test('停止後に PR 未作成などの後続行がある場合 → 直前の停止記録を返すこと', async () => {
    for (const cause of [
      'verify_pr_not_created',
      'verification_gate_failed',
      'verification_gate_repeat_hold',
    ]) {
      expect(await causeOf([{ cause }, stopped])).toBe('verification_stopped:scope,runtime');
    }
  });

  test('別の行が挟まる、または停止記録が無い場合 → 最新の cause のままにすること', async () => {
    expect(await causeOf([{ cause: 'verify_repair' }, stopped])).toBe('verify_repair');
    expect(await causeOf([{ cause: 'verify_pr_not_created' }, { cause: 'x' }, stopped])).toBe(
      'verify_pr_not_created',
    );
    expect(await causeOf([{ cause: 'verify_pr_not_created' }])).toBe('verify_pr_not_created');
  });

  test('metadata が壊れている・空の場合 → cause だけを返すこと', async () => {
    for (const metadata of [
      '{broken',
      'null',
      '{}',
      JSON.stringify({ failedChecks: 'runtime' }),
      JSON.stringify({ failedChecks: [] }),
      JSON.stringify({ failedChecks: [1, null] }),
      undefined,
    ]) {
      expect(await causeOf([{ cause: 'verification_stopped', metadata }])).toBe(
        'verification_stopped',
      );
    }
  });

  test('戻り値は入力と同一の配列参照であること（インプレース変更）', async () => {
    findMany.mockResolvedValueOnce([{ taskId: 1, cause: 'x' }]);
    const tasks: TaskLikeForBlockedCause[] = [{ id: 1, status: 'blocked' }];

    const result = await attachBlockedCauses(buildPrisma(), tasks);

    expect(result).toBe(tasks);
  });
});
