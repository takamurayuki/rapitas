/**
 * status-transition テスト — 要件-計画不整合の自動再計画配線 (task 909)
 *
 * severity>=80 の構造検証がヒットしなかった場合のみ到達する else 分岐で、
 * `.supervisor/` 参照を含む受入基準が残っていれば境界付き自動再計画へ回し、
 * 含まなければ従来どおり verify_done で完了することを検証する。
 * mock.module がプロセスグローバルなため、severity=80 系のテストを持つ
 * status-transition.test.ts とは別ファイルに分離している。
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const mockTaskUpdate = mock(() => Promise.resolve({})) as any;
const mockTaskFindUnique = mock(() =>
  Promise.resolve<{ acceptanceCriteria: string | null; description?: string | null } | null>(null),
) as any;
const mockWorkflowFileFindFirst = mock(() =>
  Promise.resolve<{ content: string } | null>(null),
) as any;
const mockPrisma = {
  task: { update: mockTaskUpdate, findUnique: mockTaskFindUnique },
  workflowTransition: { findFirst: mock(() => Promise.resolve(null)) },
  workflowFile: { findFirst: mockWorkflowFileFindFirst },
};
mock.module('../../../../config', () => ({ prisma: mockPrisma }));

mock.module('../../../../services/workflow/completion-gate', () => ({
  researchConcludesNoChange: () => false,
}));

const mockRecordTransition = mock(() => Promise.resolve()) as any;
mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: mockRecordTransition,
}));

mock.module('../../../../services/workflow/workflow-invariants', () => ({
  checkWorkflowInvariants: mock(() => Promise.resolve([])),
}));

mock.module('./shared', () => ({
  markLatestExecutionFailed: mock(() => Promise.resolve()),
  wasNonConvergenceCutoffJustRecorded: mock(() => Promise.resolve(false)),
}));

// severity<80 throughout this file — only the else-arm (structural check
// passed) under test is exercised, never the verify-self-repair bounce path.
mock.module('../../../../services/workflow/phase-output-validator', () => ({
  validateVerify: () => ({ ok: true, missingSections: [], severity: 0, summary: '' }),
}));

const mockDetectSupervisorArtifactMismatch = mock(
  () => ({ hit: false }) as { hit: boolean; criterion?: string },
);
const mockDetectGeneralRequirementMismatch = mock(() =>
  Promise.resolve({ hit: false } as { hit: boolean; criterion?: string }),
);
const mockAttemptRequirementPlanReplan = mock(() =>
  Promise.resolve({ replanned: false } as { replanned: boolean; blocked?: boolean }),
);
mock.module('../../../../services/workflow/verify-requirement-plan-mismatch', () => ({
  detectSupervisorArtifactMismatch: mockDetectSupervisorArtifactMismatch,
  detectGeneralRequirementMismatch: mockDetectGeneralRequirementMismatch,
  attemptRequirementPlanReplan: mockAttemptRequirementPlanReplan,
}));

const { computeAndApplyStatusTransition } = await import('./status-transition');

function buildParams() {
  return {
    taskId: 909,
    fileType: 'verify' as const,
    currentStatus: 'in_progress',
    savedContent: 'verify body',
  };
}

describe('computeAndApplyStatusTransition — 要件-計画不整合の自動再計画', () => {
  beforeEach(() => {
    mockTaskUpdate.mockClear();
    mockTaskFindUnique
      .mockReset()
      .mockResolvedValue({ acceptanceCriteria: null, description: null });
    mockWorkflowFileFindFirst.mockReset().mockResolvedValue(null);
    mockRecordTransition.mockClear();
    mockDetectSupervisorArtifactMismatch.mockReset().mockReturnValue({ hit: false });
    mockDetectGeneralRequirementMismatch.mockReset().mockResolvedValue({ hit: false });
    mockAttemptRequirementPlanReplan.mockReset().mockResolvedValue({ replanned: false });
  });

  test('.supervisor/ 参照が無ければ従来どおり verify_done で完了する（無関係な既存失敗には反応しない）', async () => {
    mockDetectSupervisorArtifactMismatch.mockReturnValue({ hit: false });

    const result = await computeAndApplyStatusTransition(buildParams());

    expect(result.newStatus).toBe('verify_done');
    expect(mockAttemptRequirementPlanReplan).not.toHaveBeenCalled();
    expect(result.verifyRepairBounced).toBe(false);
  });

  test('.supervisor/ 参照ありで再計画が成功したら draft へロールバックし、汎用の記録処理をスキップする', async () => {
    mockDetectSupervisorArtifactMismatch.mockReturnValue({
      hit: true,
      criterion: '.supervisor/x.patch を実装する',
    });
    mockAttemptRequirementPlanReplan.mockResolvedValue({ replanned: true });

    const result = await computeAndApplyStatusTransition(buildParams());

    expect(result.newStatus).toBe('draft');
    expect(result.verifyRepairBounced).toBe(true);
    expect(mockAttemptRequirementPlanReplan).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 909, criterion: '.supervisor/x.patch を実装する' }),
    );
    // attemptRequirementPlanReplan が自前で状態更新・監査記録を行うため、
    // status-transition.ts 側の汎用 update/recordTransition は呼ばれない。
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockRecordTransition).not.toHaveBeenCalled();
  });

  test('再計画が上限到達でブロックされたら newStatus は undefined のまま、汎用の記録処理をスキップする', async () => {
    mockDetectSupervisorArtifactMismatch.mockReturnValue({
      hit: true,
      criterion: '.supervisor/x.patch を実装する',
    });
    mockAttemptRequirementPlanReplan.mockResolvedValue({ replanned: false, blocked: true });

    const result = await computeAndApplyStatusTransition(buildParams());

    expect(result.newStatus).toBeUndefined();
    expect(result.verifyRepairBounced).toBe(true);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockRecordTransition).not.toHaveBeenCalled();
  });

  test('停止中タスク等でスキップされた場合（replanned/blocked とも false）は従来どおり verify_done とする', async () => {
    mockDetectSupervisorArtifactMismatch.mockReturnValue({
      hit: true,
      criterion: '.supervisor/x.patch を実装する',
    });
    mockAttemptRequirementPlanReplan.mockResolvedValue({ replanned: false });

    const result = await computeAndApplyStatusTransition(buildParams());

    expect(result.newStatus).toBe('verify_done');
    expect(result.verifyRepairBounced).toBe(false);
  });

  test('acceptanceCriteria の取得に用いる taskId が正しく渡ること', async () => {
    await computeAndApplyStatusTransition(buildParams());

    expect(mockTaskFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 909 } }),
    );
  });

  test('.supervisor/ 参照が無くても、パス非依存レビューが mismatch を返せば再計画へ回す', async () => {
    mockDetectSupervisorArtifactMismatch.mockReturnValue({ hit: false });
    mockDetectGeneralRequirementMismatch.mockResolvedValue({
      hit: true,
      criterion: '新しいエンドポイントを実装する',
    });
    mockAttemptRequirementPlanReplan.mockResolvedValue({ replanned: true });
    mockTaskFindUnique.mockResolvedValue({
      acceptanceCriteria: JSON.stringify(['新しいエンドポイントを実装する']),
      description: '新しいエンドポイントを実装してほしい',
    });
    mockWorkflowFileFindFirst.mockResolvedValue({ content: '対象外: 新しいエンドポイント' });

    const result = await computeAndApplyStatusTransition(buildParams());

    expect(result.newStatus).toBe('draft');
    expect(result.verifyRepairBounced).toBe(true);
    expect(mockDetectGeneralRequirementMismatch).toHaveBeenCalledWith(
      expect.objectContaining({
        description: '新しいエンドポイントを実装してほしい',
        currentPlan: '対象外: 新しいエンドポイント',
      }),
    );
    expect(mockAttemptRequirementPlanReplan).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 909, criterion: '新しいエンドポイントを実装する' }),
    );
  });

  test('.supervisor/ 参照もパス非依存レビューも不一致なら、従来どおり verify_done で完了する', async () => {
    mockDetectSupervisorArtifactMismatch.mockReturnValue({ hit: false });
    mockDetectGeneralRequirementMismatch.mockResolvedValue({ hit: false });

    const result = await computeAndApplyStatusTransition(buildParams());

    expect(result.newStatus).toBe('verify_done');
    expect(mockAttemptRequirementPlanReplan).not.toHaveBeenCalled();
  });

  test('.supervisor/ 参照がヒットすれば、パス非依存レビューは呼ばれない（コスト最適化）', async () => {
    mockDetectSupervisorArtifactMismatch.mockReturnValue({
      hit: true,
      criterion: '.supervisor/x.patch を実装する',
    });

    await computeAndApplyStatusTransition(buildParams());

    expect(mockDetectGeneralRequirementMismatch).not.toHaveBeenCalled();
  });
});
