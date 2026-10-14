/**
 * theme-pause-inflight.test
 *
 * D2: pause stops the NEXT selection; it does not stop a repair cycle that is
 * already running, and the response said only `status: paused`.
 *
 * 実測（2026-10-13、#1214）: pause 後に実行 #5812 と #5819 が発生した。
 * さらに memory の "Pause strands the only slot": pause しても実行中タスクの
 * WorkflowQueueItem が枠を離さず、MAX_CONCURRENCY=1 で全テーマが飢餓になった。
 * どちらも「止まった」と読んだ結果の事故なので、応答で両方を名指しする。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const execFindMany = mock(() => Promise.resolve([] as unknown[]));
const queueFindMany = mock(() => Promise.resolve([] as unknown[]));
mock.module('../../../config', () => ({
  prisma: {
    agentExecution: { findMany: execFindMany },
    workflowQueueItem: { findMany: queueFindMany },
  },
}));

const { describePauseScope, IN_FLIGHT_EXECUTION_STATUSES } = await import('./theme-pause-inflight');

describe('describePauseScope', () => {
  beforeEach(() => {
    execFindMany.mockReset();
    queueFindMany.mockReset();
  });

  test('何も走っていなければ空で返し、それでも note は付ける', async () => {
    execFindMany.mockResolvedValueOnce([]);
    queueFindMany.mockResolvedValueOnce([]);
    const scope = await describePauseScope(34);
    expect(scope.stillRunning).toEqual([]);
    expect(scope.heldQueueItems).toEqual([]);
    // Even with nothing in flight the caller must not read pause as a kill.
    expect(scope.note).toContain('次の選定');
  });

  test('実行中のものを taskId つきで返す', async () => {
    execFindMany.mockResolvedValueOnce([
      {
        id: 5812,
        status: 'running',
        startedAt: new Date(5),
        session: { config: { taskId: 1214 } },
      },
      {
        id: 5819,
        status: 'waiting_for_input',
        startedAt: null,
        session: { config: { taskId: 1214 } },
      },
    ]);
    queueFindMany.mockResolvedValueOnce([]);
    const scope = await describePauseScope(34);
    expect(scope.stillRunning).toEqual([
      { executionId: 5812, taskId: 1214, status: 'running', startedAt: new Date(5) },
      { executionId: 5819, taskId: 1214, status: 'waiting_for_input', startedAt: null },
    ]);
  });

  test('在庫の status 集合は正規のもの（pending も在庫）', () => {
    expect([...IN_FLIGHT_EXECUTION_STATUSES]).toEqual(['running', 'pending', 'waiting_for_input']);
  });

  // 枠の判定は workflow-queue.ts の dequeue で count({status:'running'}) のみ。
  // waiting_approval / queued を枠保持として並べると過大報告になる。
  test('枠を握る queue status は running だけを問い合わせる', async () => {
    execFindMany.mockResolvedValueOnce([]);
    queueFindMany.mockResolvedValueOnce([]);
    await describePauseScope(34);
    expect(queueFindMany).toHaveBeenCalledWith({
      where: { themeId: 34, status: { in: ['running'] } },
      select: { id: true, taskId: true, status: true },
    });
  });

  // 枠を握ったままの queue item が飢餓の原因だった。件数ではなく id を返す —
  // D3 の解放 API が受け取るのがその id だから。
  test('枠を握っている queue item を id つきで返す', async () => {
    execFindMany.mockResolvedValueOnce([]);
    queueFindMany.mockResolvedValueOnce([{ id: 77, taskId: 1214, status: 'running' }]);
    const scope = await describePauseScope(34);
    expect(scope.heldQueueItems).toEqual([{ id: 77, taskId: 1214, status: 'running' }]);
    expect(scope.note).toContain('枠');
  });

  // 読めなかったことを「走っていない」と報告するのが、この項目の元の欠陥。
  test('読み取りに失敗したら unknown を立て、空配列を「無し」と言わない', async () => {
    execFindMany.mockRejectedValueOnce(new Error('db down'));
    queueFindMany.mockResolvedValueOnce([]);
    const scope = await describePauseScope(34);
    expect(scope.unknown).toBe(true);
    expect(scope.note).toContain('確認できません');
  });

  test('両方読めたときは unknown を立てない', async () => {
    execFindMany.mockResolvedValueOnce([]);
    queueFindMany.mockResolvedValueOnce([]);
    expect((await describePauseScope(34)).unknown).toBe(false);
  });
});
