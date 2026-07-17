/**
 * phase-critic-gate テスト（applyPhaseCriticGate）
 *
 * priorBounces カウンタのフェイルクローズ検証: DBカウント失敗時に 0（fail-open）
 * ではなく cap（MAX_BOUNCES）を返し、既存の「予算枯渇時は proceed（fail-open）」
 * 分岐へ確実に流れること（= bounce を無限に繰り返さないこと）を確認する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: mock(() => {}), error: () => {}, debug: () => {} };

const mockPrisma = {
  workflowTransition: {
    count: mock(() => Promise.resolve(0)),
  },
  task: {
    update: mock(() => Promise.resolve({})),
    updateMany: mock(() => Promise.resolve({ count: 1 })),
  },
};
const recordTransition = mock(() => Promise.resolve());
const critiquePhase = mock(() =>
  Promise.resolve({ verdict: 'fail' as const, severity: 'high' as const, reasons: ['issue A'] }),
);
const isPhaseCriticEnabled = mock(() => true);
const resolveWorkflowDir = mock(() => Promise.resolve({ dir: '/tmp/wf/1' }));

mock.module('../../../config/logger', () => ({ createLogger: () => noopLogger }));
mock.module('../../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../transition-recorder', () => ({ recordTransition }));
mock.module('../workflow-file-utils', () => ({ resolveWorkflowDir }));
mock.module('../workflow-paths', () => ({
  getArchiveDir: (dir: string, stamp: string) => `${dir}/.archive/${stamp}`,
}));
mock.module('./phase-critic', () => ({ critiquePhase, isPhaseCriticEnabled }));

const { applyPhaseCriticGate } = await import('./phase-critic-gate');

describe('applyPhaseCriticGate — priorBounces fails CLOSED on DB error', () => {
  beforeEach(() => {
    mockPrisma.workflowTransition.count.mockReset().mockResolvedValue(0);
    mockPrisma.task.update.mockReset().mockResolvedValue({});
    mockPrisma.task.updateMany.mockReset().mockResolvedValue({ count: 1 });
    recordTransition.mockReset().mockResolvedValue(undefined);
    critiquePhase
      .mockReset()
      .mockResolvedValue({ verdict: 'fail', severity: 'high', reasons: ['issue A'] });
    isPhaseCriticEnabled.mockReset().mockReturnValue(true);
  });

  test('カウント成功・予算内 → bounce する（archiveせず rollback）', async () => {
    mockPrisma.workflowTransition.count.mockResolvedValue(0); // < MAX_BOUNCES(1)
    const result = await applyPhaseCriticGate({
      taskId: 1,
      phase: 'research',
      content: 'bad research',
      currentStatus: 'research_done',
    });
    expect(result.bounced).toBe(true);
    expect(result.newStatus).toBe('draft');
  });

  test('FAIL CLOSED: カウントクエリが reject しても bounce を繰り返さず proceed（fail-open分岐）すること', async () => {
    // Fault injection: a prior `.catch(() => 0)` here would make priorBounces
    // always read as 0 (< MAX_BOUNCES) on every DB hiccup, so this gate would
    // re-archive + roll back the artifact forever instead of ever reaching
    // the "budget exhausted, proceed" branch.
    mockPrisma.workflowTransition.count.mockRejectedValue(new Error('connection reset'));

    const result = await applyPhaseCriticGate({
      taskId: 1,
      phase: 'research',
      content: 'bad research',
      currentStatus: 'research_done',
    });

    // Took the budget-exhausted proceed branch, NOT another bounce.
    expect(result.bounced).toBe(false);
    expect(result.newStatus).toBeUndefined();
    const rt = recordTransition.mock.calls[0]?.[0] as { cause: string } | undefined;
    expect(rt?.cause).toBe('research_critic_exhausted');
  });
});

describe('applyPhaseCriticGate — 遅延verdictのCASガード', () => {
  beforeEach(() => {
    mockPrisma.workflowTransition.count.mockReset().mockResolvedValue(0);
    mockPrisma.task.updateMany.mockReset().mockResolvedValue({ count: 1 });
    recordTransition.mockReset().mockResolvedValue(undefined);
    resolveWorkflowDir.mockReset().mockResolvedValue({ dir: '/tmp/wf/1' });
    critiquePhase
      .mockReset()
      .mockResolvedValue({ verdict: 'fail', severity: 'high', reasons: ['issue A'] });
    isPhaseCriticEnabled.mockReset().mockReturnValue(true);
  });

  test('評価中にステータスが進んでいたら(CAS 0件) ロールバックせず fail-open', async () => {
    // task 494の再現: critic評価60-90秒の間に auto-approve が
    // plan_created → plan_approved に進めた。遅れて届いたFAILは
    // 生きている状態を踏み潰してはならない。
    mockPrisma.workflowTransition.count.mockResolvedValue(0);
    mockPrisma.task.updateMany.mockResolvedValue({ count: 0 }); // 別状態に遷移済み

    const result = await applyPhaseCriticGate({
      taskId: 494,
      phase: 'plan',
      content: 'plan body',
      currentStatus: 'plan_created',
    });

    expect(result.bounced).toBe(false);
    expect(result.newStatus).toBeUndefined();
    // ロールバック遷移もアーティファクトのarchiveも発生しない。
    expect(recordTransition).not.toHaveBeenCalled();
    expect(resolveWorkflowDir).not.toHaveBeenCalled();
  });

  test('CASが1件更新できたら通常どおり bounce する', async () => {
    mockPrisma.workflowTransition.count.mockResolvedValue(0);
    mockPrisma.task.updateMany.mockResolvedValue({ count: 1 });

    const result = await applyPhaseCriticGate({
      taskId: 494,
      phase: 'plan',
      content: 'plan body',
      currentStatus: 'plan_created',
    });

    expect(result.bounced).toBe(true);
    expect(result.newStatus).toBe('research_done');
    const call = mockPrisma.task.updateMany.mock.calls[0]?.[0] as {
      where: { id: number; workflowStatus: string };
    };
    // ガード条件が評価時点のステータスを固定していること。
    expect(call.where).toEqual({ id: 494, workflowStatus: 'plan_created' });
  });
});
