/**
 * queue-slot-release.test
 *
 * D3: there was no legitimate way to free a concurrency slot. The only API
 * that cancels a task's queue items is reset-execution-state, and it calls
 * removeWorktree first (reset-route.ts:132) — so freeing the slot destroyed
 * the uncommitted implementation. #1214's 193 tests existed only in that
 * working tree, which is why the slot was freed by writing to SQLite by hand.
 *
 * The hazard this has to avoid is the opposite one: a `running` queue item
 * whose agent is genuinely alive is not stranded, and releasing it lets a
 * second agent start on the same task and worktree.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const execFindMany = mock(() => Promise.resolve([] as unknown[]));
const queueFindMany = mock(() => Promise.resolve([] as unknown[]));
const queueUpdateMany = mock(() => Promise.resolve({ count: 0 }));
mock.module('../../config', () => ({
  prisma: {
    agentExecution: { findMany: execFindMany },
    workflowQueueItem: { findMany: queueFindMany, updateMany: queueUpdateMany },
  },
}));

const recordTransitionMock = mock(() => Promise.resolve());
mock.module('./transition-recorder', () => ({ recordTransition: recordTransitionMock }));

const { releaseQueueSlot, RELEASABLE_QUEUE_STATUSES } = await import('./queue-slot-release');

const item = (over: Partial<{ id: number; status: string }> = {}) => ({
  id: 77,
  taskId: 1214,
  status: 'running',
  ...over,
});

describe('releaseQueueSlot', () => {
  beforeEach(() => {
    execFindMany.mockReset();
    queueFindMany.mockReset();
    queueUpdateMany.mockReset();
    recordTransitionMock.mockClear();
  });

  test('解放可能な status は非終端の3つ', () => {
    expect([...RELEASABLE_QUEUE_STATUSES]).toEqual(['queued', 'running', 'waiting_approval']);
  });

  test('item が無ければ no_items を返し、何も書かない', async () => {
    queueFindMany.mockResolvedValueOnce([]);
    execFindMany.mockResolvedValueOnce([]);
    const result = await releaseQueueSlot(1214, { actorLabel: 'ユーザー操作' });
    expect(result).toMatchObject({ ok: false, reason: 'no_items' });
    expect(queueUpdateMany).not.toHaveBeenCalled();
  });

  test('item を cancelled にして件数と id を返す', async () => {
    queueFindMany.mockResolvedValueOnce([item(), item({ id: 78, status: 'queued' })]);
    execFindMany.mockResolvedValueOnce([]);
    queueUpdateMany.mockResolvedValueOnce({ count: 2 });
    const result = await releaseQueueSlot(1214, { actorLabel: 'ユーザー操作' });
    expect(result).toMatchObject({ ok: true, released: 2, itemIds: [77, 78] });
    expect(recordTransitionMock).toHaveBeenCalledTimes(1);
  });

  // 生きているエージェントの枠を奪うと、同じ worktree に2つ目が入る。
  test('実行中のエージェントがいれば拒否し、その execution を名指しする', async () => {
    queueFindMany.mockResolvedValueOnce([item()]);
    execFindMany.mockResolvedValueOnce([{ id: 5901, status: 'running' }]);
    const result = await releaseQueueSlot(1214, { actorLabel: 'ユーザー操作' });
    expect(result).toMatchObject({ ok: false, reason: 'execution_in_flight' });
    expect(result).toMatchObject({ inFlightExecutionIds: [5901] });
    expect(queueUpdateMany).not.toHaveBeenCalled();
  });

  test('force なら実行中でも解放する（運用者が判断した場合のみ）', async () => {
    queueFindMany.mockResolvedValueOnce([item()]);
    execFindMany.mockResolvedValueOnce([{ id: 5901, status: 'running' }]);
    queueUpdateMany.mockResolvedValueOnce({ count: 1 });
    const result = await releaseQueueSlot(1214, { actorLabel: 'ユーザー操作', force: true });
    expect(result).toMatchObject({ ok: true, released: 1, forced: true });
  });

  // この API の存在理由そのもの。worktree にも session にも task にも触らない。
  test('worktree / session / task には一切触らない', async () => {
    queueFindMany.mockResolvedValueOnce([item()]);
    execFindMany.mockResolvedValueOnce([]);
    queueUpdateMany.mockResolvedValueOnce({ count: 1 });
    await releaseQueueSlot(1214, { actorLabel: 'ユーザー操作' });
    const [args] = queueUpdateMany.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(args.data as Record<string, unknown>)).toEqual([
      'status',
      'completedAt',
      'errorMessage',
    ]);
  });

  test('書き込みが失敗したら write_failed を返す（成功と報告しない）', async () => {
    queueFindMany.mockResolvedValueOnce([item()]);
    execFindMany.mockResolvedValueOnce([]);
    queueUpdateMany.mockRejectedValueOnce(new Error('db down'));
    const result = await releaseQueueSlot(1214, { actorLabel: 'ユーザー操作' });
    expect(result).toMatchObject({ ok: false, reason: 'write_failed' });
  });

  test('item の読み取り失敗も成功と報告しない', async () => {
    queueFindMany.mockRejectedValueOnce(new Error('db down'));
    execFindMany.mockResolvedValueOnce([]);
    const result = await releaseQueueSlot(1214, { actorLabel: 'ユーザー操作' });
    expect(result).toMatchObject({ ok: false, reason: 'read_failed' });
  });
});
