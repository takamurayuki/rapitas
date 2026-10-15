/**
 * blocked-cause テスト
 * attachBlockedCauses (batched WorkflowTransition.cause lookup) のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';
import { attachBlockedCauses } from '../../services/task/blocked-cause';

describe('attachBlockedCauses', () => {
  let findMany: ReturnType<typeof mock>;
  let fakePrisma: PrismaClient;

  beforeEach(() => {
    findMany = mock(() => Promise.resolve([]));
    // NOTE: Only the one method attachBlockedCauses actually calls is stubbed;
    // cast through `unknown` since a full PrismaClient double would be enormous.
    fakePrisma = { workflowTransition: { findMany } } as unknown as PrismaClient;
  });

  test('blocked タスクが無ければ問い合わせを行わないこと', async () => {
    const tasks = [
      { id: 1, status: 'todo' },
      { id: 2, status: 'done' },
    ];

    const result = await attachBlockedCauses(fakePrisma, tasks);

    expect(findMany).not.toHaveBeenCalled();
    expect(result).toBe(tasks);
    expect(result[0]!.blockedCause).toBeUndefined();
  });

  test('blocked タスク全件を1回のクエリで解決すること', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve([
        { taskId: 2, cause: 'verify_pr_not_created' },
        { taskId: 3, cause: 'subtask_failed' },
      ]),
    );
    const tasks = [
      { id: 1, status: 'todo' },
      { id: 2, status: 'blocked' },
      { id: 3, status: 'blocked' },
    ];

    const result = await attachBlockedCauses(fakePrisma, tasks);

    expect(findMany).toHaveBeenCalledTimes(1);
    const call = findMany.mock.calls[0]![0] as { where: { taskId: { in: number[] } } };
    expect(call.where.taskId.in.sort()).toEqual([2, 3]);
    expect(result[0]!.blockedCause).toBeUndefined();
    expect(result[1]!.blockedCause).toBe('verify_pr_not_created');
    expect(result[2]!.blockedCause).toBe('subtask_failed');
  });

  test('複数トランジションがあっても最新（先頭）のcauseのみ採用すること', async () => {
    // findMany is ordered desc by createdAt in the real query — the mock
    // returns rows already in that order, latest first.
    findMany.mockImplementation(() =>
      Promise.resolve([
        { taskId: 2, cause: 'verify_pr_not_created' },
        { taskId: 2, cause: 'plan_invalid_replan_exhausted' },
      ]),
    );
    const tasks = [{ id: 2, status: 'blocked' }];

    const result = await attachBlockedCauses(fakePrisma, tasks);

    expect(result[0]!.blockedCause).toBe('verify_pr_not_created');
  });

  test('blocked タスクにトランジション行が無ければ null を設定すること', async () => {
    const tasks = [{ id: 5, status: 'blocked' }];

    const result = await attachBlockedCauses(fakePrisma, tasks);

    expect(result[0]!.blockedCause).toBeNull();
  });

  test('ネストしたサブタスクの blocked も再帰的に解決すること', async () => {
    findMany.mockImplementation(() =>
      Promise.resolve([{ taskId: 11, cause: 'verify_no_changes' }]),
    );
    const tasks = [
      {
        id: 10,
        status: 'todo',
        subtasks: [{ id: 11, status: 'blocked' }],
      },
    ];

    const result = await attachBlockedCauses(fakePrisma, tasks);

    const call = findMany.mock.calls[0]![0] as { where: { taskId: { in: number[] } } };
    expect(call.where.taskId.in).toEqual([11]);
    expect(result[0]!.subtasks![0]!.blockedCause).toBe('verify_no_changes');
  });
});
