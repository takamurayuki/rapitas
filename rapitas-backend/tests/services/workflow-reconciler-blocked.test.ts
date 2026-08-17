/**
 * workflow-reconciler-blocked テスト
 *
 * blocked ヒールパス（受入基準1〜4）: 成功証拠あり → done 是正（再試行なし）、
 * 証拠なし → requeueBlockedTasks が従来どおり盲目再試行、awaiting_question は
 * 盲目再試行されない（最重要回帰）、retryable はエスカレーションされない
 * （プレモーテム2）、classifyBlockedExclusion の境界値、を検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([] as unknown[])),
    update: mock(() => Promise.resolve({})),
  },
  agentExecution: { findFirst: mock(() => Promise.resolve(null as unknown)) },
  workflowTransition: { count: mock(() => Promise.resolve(0)) },
  themeAutoRun: { findMany: mock(() => Promise.resolve([{ themeId: 1 }] as unknown[])) },
  userSettings: { findFirst: mock(() => Promise.resolve(null as unknown)) },
  activityLog: { findFirst: mock(() => Promise.resolve(null as unknown)) },
};
const recordTransition = mock(() => Promise.resolve());
const resolveBlockedTaskEvidence = mock(() =>
  Promise.resolve({ isSuccess: false, source: 'none' as const }),
);
const escalateBlockedTask = mock(() => Promise.resolve(true));

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('../../services/workflow/transition-recorder', () => ({ recordTransition }));
mock.module('../../services/workflow/blocked-task-evidence', () => ({
  resolveBlockedTaskEvidence,
}));
mock.module('../../services/workflow/blocked-task-escalation', () => ({
  escalateBlockedTask,
  countEscalatedBlocked: mock(() => Promise.resolve(0)),
  BLOCKED_ESCALATED_CAUSE: 'blocked_escalated',
}));

const { correctBlockedByEvidence, escalateAbandonedBlocked } =
  await import('../../services/workflow/workflow-reconciler-blocked');
const { requeueBlockedTasks } = await import('../../services/workflow/workflow-reconciler-requeue');
const { classifyBlockedExclusion, MAX_ORPHAN_REQUEUE_AGE_MS } =
  await import('../../services/workflow/blocked-task-policy');

const NOW = 1_800_000_000_000;
const OLD = new Date(NOW - 60 * 60 * 1000); // 1h 前（settle 済み・2日以内）
const ANCIENT = new Date(NOW - 3 * 24 * 60 * 60 * 1000); // 3日前（再試行対象外の古さ）

function blockedTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 595,
    title: 'blocked タスク',
    themeId: 1,
    workflowStatus: 'draft',
    completedAt: null,
    updatedAt: OLD,
    ...overrides,
  };
}

beforeEach(() => {
  mockPrisma.task.findMany.mockReset().mockResolvedValue([]);
  mockPrisma.task.update.mockReset().mockResolvedValue({});
  mockPrisma.agentExecution.findFirst.mockReset().mockResolvedValue(null);
  mockPrisma.workflowTransition.count.mockReset().mockResolvedValue(0);
  mockPrisma.themeAutoRun.findMany.mockReset().mockResolvedValue([{ themeId: 1 }]);
  mockPrisma.userSettings.findFirst.mockReset().mockResolvedValue(null);
  mockPrisma.activityLog.findFirst.mockReset().mockResolvedValue(null);
  recordTransition.mockReset().mockResolvedValue(undefined);
  resolveBlockedTaskEvidence.mockReset().mockResolvedValue({ isSuccess: false, source: 'none' });
  escalateBlockedTask.mockReset().mockResolvedValue(true);
});

describe('correctBlockedByEvidence（受入基準1・3）', () => {
  test('成功証拠あり → done + workflowStatus completed へ是正し blocked_evidence_done を記録', async () => {
    mockPrisma.task.findMany.mockResolvedValue([blockedTask()]);
    resolveBlockedTaskEvidence.mockResolvedValue({
      isSuccess: true,
      source: 'linked_pr',
      prState: 'open',
    });

    const corrected = await correctBlockedByEvidence(NOW);

    expect(corrected).toBe(1);
    const tu = mockPrisma.task.update.mock.calls[0][0] as {
      data: { status: string; workflowStatus: string; completedAt: Date };
    };
    expect(tu.data.status).toBe('done');
    expect(tu.data.workflowStatus).toBe('completed');
    expect(tu.data.completedAt).toBeInstanceOf(Date);
    const rt = recordTransition.mock.calls[0][0] as { cause: string; toStatus: string };
    expect(rt.cause).toBe('blocked_evidence_done');
    expect(rt.toStatus).toBe('completed');
  });

  test('既存 completedAt がある場合はそれを尊重する', async () => {
    const existing = new Date(NOW - 2 * 60 * 60 * 1000);
    mockPrisma.task.findMany.mockResolvedValue([blockedTask({ completedAt: existing })]);
    resolveBlockedTaskEvidence.mockResolvedValue({
      isSuccess: true,
      source: 'linked_pr',
      prState: 'merged',
    });

    await correctBlockedByEvidence(NOW);

    const tu = mockPrisma.task.update.mock.calls[0][0] as { data: { completedAt: Date } };
    expect(tu.data.completedAt).toBe(existing);
  });

  test('補完: awaiting_question × 成功証拠あり → done 是正される（是正は盲目再試行ではない）', async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      blockedTask({ id: 578, workflowStatus: 'awaiting_question' }),
    ]);
    resolveBlockedTaskEvidence.mockResolvedValue({
      isSuccess: true,
      source: 'scoped_pr',
      prState: 'open',
    });

    const corrected = await correctBlockedByEvidence(NOW);

    expect(corrected).toBe(1);
    const tu = mockPrisma.task.update.mock.calls[0][0] as {
      data: { status: string; workflowStatus: string };
    };
    // 質問を破壊する draft リセットではなく、done への直接確定であること
    expect(tu.data.status).toBe('done');
    expect(tu.data.workflowStatus).toBe('completed');
  });

  test('受入3: 証拠が曖昧（isSuccess=false）なら是正しない', async () => {
    mockPrisma.task.findMany.mockResolvedValue([blockedTask()]);
    resolveBlockedTaskEvidence.mockResolvedValue({
      isSuccess: false,
      source: 'none',
      prState: 'closed',
    });

    const corrected = await correctBlockedByEvidence(NOW);

    expect(corrected).toBe(0);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  test('live 実行が居るタスクはスキップ', async () => {
    mockPrisma.task.findMany.mockResolvedValue([blockedTask()]);
    mockPrisma.agentExecution.findFirst.mockResolvedValue({ id: 1 });
    resolveBlockedTaskEvidence.mockResolvedValue({ isSuccess: true, source: 'linked_pr' });

    const corrected = await correctBlockedByEvidence(NOW);

    expect(corrected).toBe(0);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  test('候補クエリに上限年齢（notOlderThan）が無い（古い blocked も是正対象）', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    await correctBlockedByEvidence(NOW);

    const where = (
      mockPrisma.task.findMany.mock.calls[0][0] as {
        where: { updatedAt: Record<string, unknown> };
      }
    ).where;
    expect(where.updatedAt.lt).toBeInstanceOf(Date);
    expect(where.updatedAt.gt).toBeUndefined();
  });
});

describe('requeueBlockedTasks 回帰（受入基準2・4）', () => {
  test('受入2: 成功証拠なしの blocked は従来どおり盲目再試行される（blocked_auto_retry）', async () => {
    // 是正パスは何もしない
    mockPrisma.task.findMany.mockResolvedValue([blockedTask()]);
    const corrected = await correctBlockedByEvidence(NOW);
    expect(corrected).toBe(0);

    // requeue は同じタスクを todo/draft へ戻す
    mockPrisma.task.findMany.mockReset().mockResolvedValue([{ id: 595, workflowStatus: 'draft' }]);
    const retried = await requeueBlockedTasks(NOW);

    expect(retried).toBe(1);
    const tu = mockPrisma.task.update.mock.calls[0][0] as {
      data: { status: string; workflowStatus: string };
    };
    expect(tu.data.status).toBe('todo');
    expect(tu.data.workflowStatus).toBe('draft');
    const rt = recordTransition.mock.calls[0][0] as { cause: string };
    expect(rt.cause).toBe('blocked_auto_retry');
  });

  test('受入4（最重要回帰）: awaiting_question は盲目再試行されない', async () => {
    mockPrisma.task.findMany.mockResolvedValue([{ id: 578, workflowStatus: 'awaiting_question' }]);

    const retried = await requeueBlockedTasks(NOW);

    expect(retried).toBe(0);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
  });
});

describe('escalateAbandonedBlocked（受入基準5まわり・プレモーテム2）', () => {
  test('retryable と分類されるタスクはエスカレーションされない（requeue が担当）', async () => {
    mockPrisma.task.findMany.mockResolvedValue([blockedTask()]); // 1h前・repairs 0・attempts 0

    const escalated = await escalateAbandonedBlocked(NOW);

    expect(escalated).toBe(0);
    expect(escalateBlockedTask).not.toHaveBeenCalled();
  });

  test('awaiting_question は理由 awaiting_question でエスカレーションされる', async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      blockedTask({ id: 597, workflowStatus: 'awaiting_question' }),
    ]);

    const escalated = await escalateAbandonedBlocked(NOW);

    expect(escalated).toBe(1);
    const call = escalateBlockedTask.mock.calls[0] as unknown[];
    expect((call[1] as { id: number }).id).toBe(597);
    expect(call[2]).toBe('awaiting_question');
  });

  test('2日超の古い blocked は abandoned_old でエスカレーションされる（条件4の救済）', async () => {
    mockPrisma.task.findMany.mockResolvedValue([blockedTask({ updatedAt: ANCIENT })]);

    const escalated = await escalateAbandonedBlocked(NOW);

    expect(escalated).toBe(1);
    const call = escalateBlockedTask.mock.calls[0] as unknown[];
    expect(call[2]).toBe('abandoned_old');
  });

  test('再試行上限到達 (attempts >= 2) は retry_cap_exhausted でエスカレーションされる', async () => {
    mockPrisma.task.findMany.mockResolvedValue([blockedTask()]);
    mockPrisma.workflowTransition.count.mockImplementation((args: unknown) => {
      const where = (args as { where: { cause: string } }).where;
      return Promise.resolve(where.cause === 'blocked_auto_retry' ? 2 : 0);
    });

    const escalated = await escalateAbandonedBlocked(NOW);

    expect(escalated).toBe(1);
    const call = escalateBlockedTask.mock.calls[0] as unknown[];
    expect(call[2]).toBe('retry_cap_exhausted');
  });

  test('成功証拠のあるタスクはエスカレーションしない（是正パスの担当）', async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      blockedTask({ workflowStatus: 'awaiting_question' }),
    ]);
    resolveBlockedTaskEvidence.mockResolvedValue({ isSuccess: true, source: 'linked_pr' });

    const escalated = await escalateAbandonedBlocked(NOW);

    expect(escalated).toBe(0);
    expect(escalateBlockedTask).not.toHaveBeenCalled();
  });
});

describe('classifyBlockedExclusion（境界値）', () => {
  const base = {
    workflowStatus: 'draft',
    ageMs: 1000,
    repairs: 0,
    verifyRepairLimit: 3,
    attempts: 0,
  };

  test('既定は retryable', () => {
    expect(classifyBlockedExclusion(base)).toBe('retryable');
  });

  test('awaiting_question が他のどの条件よりも優先される', () => {
    expect(
      classifyBlockedExclusion({
        ...base,
        workflowStatus: 'awaiting_question',
        ageMs: MAX_ORPHAN_REQUEUE_AGE_MS + 1,
        repairs: 99,
        attempts: 99,
      }),
    ).toBe('awaiting_question');
  });

  test('年齢境界: ちょうど上限は retryable、超過で abandoned_old', () => {
    expect(classifyBlockedExclusion({ ...base, ageMs: MAX_ORPHAN_REQUEUE_AGE_MS })).toBe(
      'retryable',
    );
    expect(classifyBlockedExclusion({ ...base, ageMs: MAX_ORPHAN_REQUEUE_AGE_MS + 1 })).toBe(
      'abandoned_old',
    );
  });

  test('修復予算境界: repairs >= limit で verify_repair_exhausted', () => {
    expect(classifyBlockedExclusion({ ...base, repairs: 2 })).toBe('retryable');
    expect(classifyBlockedExclusion({ ...base, repairs: 3 })).toBe('verify_repair_exhausted');
  });

  test('再試行上限境界: attempts >= 2 で retry_cap_exhausted', () => {
    expect(classifyBlockedExclusion({ ...base, attempts: 1 })).toBe('retryable');
    expect(classifyBlockedExclusion({ ...base, attempts: 2 })).toBe('retry_cap_exhausted');
  });
});
