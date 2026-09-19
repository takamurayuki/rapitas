/**
 * verify-requirement-plan-mismatch テスト
 *
 * task 906/909: `.supervisor/` 参照を含む受入基準を検出し、境界付き・監査付き・
 * SYSTEM 発の自動再計画（`requirement_plan_mismatch_replan`）へロールバックする
 * ことを検証する。停止中タスクは再開させない、DBエラー/更新失敗時は進行しない、
 * 上限到達でブロックする、`.supervisor/` を含まない通常の未達基準では一切発火
 * しない（無関係な既存失敗との区別）— の4点が中心。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

interface TaskSnapshot {
  status: string;
  workflowStatus?: string;
  updatedAt?: Date;
}
const mockTaskFindUnique = mock(() => Promise.resolve<TaskSnapshot | null>(null));
const mockTaskUpdateMany = mock(() => Promise.resolve({ count: 1 }));
const mockTransitionFindFirst = mock(() => Promise.resolve<{ cause: string } | null>(null));
const mockTransitionCount = mock(() => Promise.resolve(0));
const mockPrisma = {
  task: { findUnique: mockTaskFindUnique, updateMany: mockTaskUpdateMany },
  workflowTransition: { findFirst: mockTransitionFindFirst, count: mockTransitionCount },
};
mock.module('../../config', () => ({ prisma: mockPrisma }));

const mockReviewRequirementPlanMismatch = mock(() =>
  Promise.resolve<{
    verdict: 'mismatch' | 'no_mismatch' | 'unknown';
    sourceQuote: string | null;
    reason: string;
  }>({ verdict: 'no_mismatch', sourceQuote: null, reason: 'default' }),
);
mock.module('./requirement-plan-mismatch-reviewer', () => ({
  reviewRequirementPlanMismatch: mockReviewRequirementPlanMismatch,
}));

const mockArchiveWorkflowFile = mock(() => Promise.resolve(true));
mock.module('./workflow-file-utils', () => ({ archiveWorkflowFile: mockArchiveWorkflowFile }));

const recordedTransitions: Array<{ cause: string; toStatus: string; metadata?: unknown }> = [];
const mockRecordTransition = mock(
  (args: { cause: string; toStatus: string; metadata?: unknown }) => {
    recordedTransitions.push(args);
    return Promise.resolve();
  },
);
mock.module('./transition-recorder', () => ({ recordTransition: mockRecordTransition }));

const mockWriteBlockedStatusDurable = mock(() => Promise.resolve(true));
mock.module('./durable-blocked-write', () => ({
  writeBlockedStatusDurable: mockWriteBlockedStatusDurable,
}));

const mockScheduleWorkflowRedispatch = mock(() => {});
mock.module('./workflow-redispatch', () => ({
  scheduleWorkflowRedispatch: mockScheduleWorkflowRedispatch,
}));

const {
  detectSupervisorArtifactMismatch,
  detectGeneralRequirementMismatch,
  attemptRequirementPlanReplan,
  REQUIREMENT_MISMATCH_CAUSE,
} = await import('./verify-requirement-plan-mismatch');

function baseParams(overrides: Partial<Parameters<typeof attemptRequirementPlanReplan>[0]> = {}) {
  return {
    taskId: 909,
    currentStatus: 'in_progress',
    criterion: '.supervisor/measurements/task906-red.patch のとおりに適用される',
    language: 'ja' as const,
    ...overrides,
  };
}

describe('detectSupervisorArtifactMismatch', () => {
  test('.supervisor/ 参照を含む基準を検出する', () => {
    const result = detectSupervisorArtifactMismatch([
      '正当な基準',
      '.supervisor/measurements/x.patch のとおりに実装する',
    ]);
    expect(result.hit).toBe(true);
    expect(result.criterion).toContain('.supervisor/');
  });

  test('.supervisor/ を含まない基準では発火しない', () => {
    expect(detectSupervisorArtifactMismatch(['正当な基準1', '正当な基準2'])).toEqual({
      hit: false,
    });
  });

  test('空配列では発火しない', () => {
    expect(detectSupervisorArtifactMismatch([])).toEqual({ hit: false });
  });
});

describe('attemptRequirementPlanReplan', () => {
  beforeEach(() => {
    mockTaskFindUnique.mockReset().mockResolvedValue({
      status: 'in-progress',
      workflowStatus: 'in_progress',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    mockTaskUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    mockTransitionFindFirst.mockReset().mockResolvedValue(null);
    mockTransitionCount.mockReset().mockResolvedValue(0);
    mockArchiveWorkflowFile.mockReset().mockResolvedValue(true);
    mockRecordTransition
      .mockReset()
      .mockImplementation((args: { cause: string; toStatus: string }) => {
        recordedTransitions.push(args);
        return Promise.resolve();
      });
    recordedTransitions.length = 0;
    mockWriteBlockedStatusDurable.mockReset().mockResolvedValue(true);
    mockScheduleWorkflowRedispatch.mockReset();
    mockReviewRequirementPlanMismatch
      .mockReset()
      .mockResolvedValue({ verdict: 'no_mismatch', sourceQuote: null, reason: 'default' });
  });

  test('上限未到達なら plan.md を退避し draft へロールバック、SYSTEM cause で監査記録する', async () => {
    mockTransitionCount.mockResolvedValue(0);

    const result = await attemptRequirementPlanReplan(baseParams());

    expect(result).toEqual({ replanned: true });
    expect(mockArchiveWorkflowFile).toHaveBeenCalledWith(909, 'plan');
    expect(mockTaskUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 909,
        status: 'in-progress',
        workflowStatus: 'in_progress',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      data: expect.objectContaining({ workflowStatus: 'draft' }),
    });
    expect(recordedTransitions).toHaveLength(1);
    expect(recordedTransitions[0].cause).toBe(REQUIREMENT_MISMATCH_CAUSE);
    expect(recordedTransitions[0].toStatus).toBe('draft');
    // 人間発の plan_revision_requested とは異なる cause — 出所を偽装しない。
    expect(recordedTransitions[0].cause).not.toBe('plan_revision_requested');
    expect(mockScheduleWorkflowRedispatch).toHaveBeenCalledWith(
      909,
      'requirement_plan_mismatch',
      'ja',
    );
  });

  for (const stopCause of [
    'manual_execution_stop_revert',
    'manual_execution_stop_withdraw',
    'auto_run_stop_revert',
  ] as const) {
    test(`停止中タスク（status=todo, 直近停止cause=${stopCause}）は再計画しない`, async () => {
      mockTaskFindUnique.mockResolvedValue({ status: 'todo' });
      mockTransitionFindFirst.mockResolvedValue({ cause: stopCause });

      const result = await attemptRequirementPlanReplan(baseParams());

      expect(result).toEqual({ replanned: false });
      expect(mockArchiveWorkflowFile).not.toHaveBeenCalled();
      expect(mockTaskUpdateMany).not.toHaveBeenCalled();
      expect(mockRecordTransition).not.toHaveBeenCalled();
      expect(mockScheduleWorkflowRedispatch).not.toHaveBeenCalled();
    });
  }

  for (const terminalStatus of ['done', 'completed', 'cancelled'] as const) {
    test(`終端状態（status=${terminalStatus}）は停止扱いとし再計画しない（task 901型の completed→awaiting_question 上書き再発防止）`, async () => {
      mockTaskFindUnique.mockResolvedValue({ status: terminalStatus });

      const result = await attemptRequirementPlanReplan(baseParams());

      expect(result).toEqual({ replanned: false });
      expect(mockTransitionFindFirst).not.toHaveBeenCalled();
      expect(mockArchiveWorkflowFile).not.toHaveBeenCalled();
      expect(mockTaskUpdateMany).not.toHaveBeenCalled();
      expect(mockRecordTransition).not.toHaveBeenCalled();
    });
  }

  test('読込直後・書込直前の間に別プロセスが更新した場合（CAS 0件ヒット）はロールバックせず進行しない', async () => {
    mockTaskUpdateMany.mockResolvedValue({ count: 0 });

    const result = await attemptRequirementPlanReplan(baseParams());

    expect(result).toEqual({ replanned: false });
    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(mockScheduleWorkflowRedispatch).not.toHaveBeenCalled();
  });

  test('書込直前の再読込で終端状態に変わっていた場合は書き込みを行わず進行しない', async () => {
    // 1回目（isTaskStopped）は非終端、2回目（ロールバック直前の再読込）で終端に変化。
    let call = 0;
    mockTaskFindUnique.mockImplementation(() => {
      call += 1;
      return Promise.resolve(call === 1 ? { status: 'in-progress' } : { status: 'completed' });
    });

    const result = await attemptRequirementPlanReplan(baseParams());

    expect(result).toEqual({ replanned: false });
    expect(mockArchiveWorkflowFile).not.toHaveBeenCalled();
    expect(mockTaskUpdateMany).not.toHaveBeenCalled();
  });

  test('書込直前の再読込に失敗した場合は進行しない（fail-closed）', async () => {
    let call = 0;
    mockTaskFindUnique.mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ status: 'in-progress' });
      return Promise.reject(new Error('db down'));
    });

    const result = await attemptRequirementPlanReplan(baseParams());

    expect(result).toEqual({ replanned: false });
    expect(mockArchiveWorkflowFile).not.toHaveBeenCalled();
    expect(mockTaskUpdateMany).not.toHaveBeenCalled();
  });

  test('status=todo でも直近transitionが停止causeでなければ再計画する', async () => {
    mockTaskFindUnique.mockResolvedValue({ status: 'todo' });
    mockTransitionFindFirst.mockResolvedValue({ cause: 'some_other_cause' });

    const result = await attemptRequirementPlanReplan(baseParams());

    expect(result).toEqual({ replanned: true });
  });

  test('上限到達（MAX_REQUIREMENT_REPLANS件）ならブロックし、silent completeしない', async () => {
    mockTransitionCount.mockResolvedValue(3);

    const result = await attemptRequirementPlanReplan(baseParams());

    expect(result).toEqual({ replanned: false, blocked: true });
    expect(mockWriteBlockedStatusDurable).toHaveBeenCalledTimes(1);
    expect(mockArchiveWorkflowFile).not.toHaveBeenCalled();
    expect(mockTaskUpdateMany).not.toHaveBeenCalled();
    expect(recordedTransitions).toHaveLength(1);
    expect(recordedTransitions[0].cause).toBe(`${REQUIREMENT_MISMATCH_CAUSE}_exhausted`);
  });

  test('カウントクエリが失敗したら fail-closed で上限扱いにしブロックする', async () => {
    mockTransitionCount.mockImplementation(() => Promise.reject(new Error('db down')));

    const result = await attemptRequirementPlanReplan(baseParams());

    expect(result).toEqual({ replanned: false, blocked: true });
    expect(mockWriteBlockedStatusDurable).toHaveBeenCalledTimes(1);
  });

  test('status 参照クエリが失敗したら DBエラーとして進行しない（fail-closed）', async () => {
    mockTaskFindUnique.mockImplementation(() => Promise.reject(new Error('db down')));

    const result = await attemptRequirementPlanReplan(baseParams());

    expect(result).toEqual({ replanned: false });
    expect(mockArchiveWorkflowFile).not.toHaveBeenCalled();
    expect(mockRecordTransition).not.toHaveBeenCalled();
  });

  test('workflowStatus ロールバック書き込みが失敗したら transition を記録せず次回save再評価に委ねる', async () => {
    mockTaskUpdateMany.mockImplementation(() => Promise.reject(new Error('write failed')));

    const result = await attemptRequirementPlanReplan(baseParams());

    expect(result).toEqual({ replanned: false });
    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(mockScheduleWorkflowRedispatch).not.toHaveBeenCalled();
  });

  test('タスクが見つからない場合は進行しない', async () => {
    mockTaskFindUnique.mockResolvedValue(null);

    const result = await attemptRequirementPlanReplan(baseParams());

    expect(result).toEqual({ replanned: false });
    expect(mockArchiveWorkflowFile).not.toHaveBeenCalled();
  });
});

describe('detectGeneralRequirementMismatch (パス名非依存フォールバック)', () => {
  beforeEach(() => {
    mockReviewRequirementPlanMismatch.mockReset();
  });

  test('原文根拠付き mismatch が返れば、その基準をヒットとして返す', async () => {
    mockReviewRequirementPlanMismatch.mockResolvedValueOnce({
      verdict: 'mismatch',
      sourceQuote: '.supervisor/ とは無関係な新規実装要求',
      reason: '明示的な要求がある',
    });

    const result = await detectGeneralRequirementMismatch({
      acceptanceCriteria: ['新しいエンドポイントを実装する'],
      description: '.supervisor/ とは無関係な新規実装要求',
      currentPlan: '対象外',
    });

    expect(result).toEqual({ hit: true, criterion: '新しいエンドポイントを実装する' });
  });

  test('過去の調査記録を背景とした no_mismatch では発火しない', async () => {
    mockReviewRequirementPlanMismatch.mockResolvedValue({
      verdict: 'no_mismatch',
      sourceQuote: null,
      reason: '過去記録',
    });

    const result = await detectGeneralRequirementMismatch({
      acceptanceCriteria: ['過去に確認した手順どおりに動作する'],
      description: '以前に手動でテストを実施し確認済みである。',
      currentPlan: '対象外',
    });

    expect(result).toEqual({ hit: false });
  });

  test('unknown（原文引用なし等）では発火しない', async () => {
    mockReviewRequirementPlanMismatch.mockResolvedValue({
      verdict: 'unknown',
      sourceQuote: null,
      reason: 'ungrounded_source_quote',
    });

    const result = await detectGeneralRequirementMismatch({
      acceptanceCriteria: ['曖昧な基準'],
      description: '説明',
      currentPlan: '計画',
    });

    expect(result).toEqual({ hit: false });
  });

  test('最大3件までのみレビューし、それ以降はコストのため呼ばない', async () => {
    mockReviewRequirementPlanMismatch.mockResolvedValue({
      verdict: 'no_mismatch',
      sourceQuote: null,
      reason: 'x',
    });

    await detectGeneralRequirementMismatch({
      acceptanceCriteria: ['基準1', '基準2', '基準3', '基準4', '基準5'],
      description: '説明',
      currentPlan: '計画',
    });

    expect(mockReviewRequirementPlanMismatch).toHaveBeenCalledTimes(3);
  });

  test('空配列ではAIを呼ばずヒットなしを返す', async () => {
    const result = await detectGeneralRequirementMismatch({
      acceptanceCriteria: [],
      description: '説明',
      currentPlan: '計画',
    });

    expect(result).toEqual({ hit: false });
    expect(mockReviewRequirementPlanMismatch).not.toHaveBeenCalled();
  });
});
