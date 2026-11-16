/**
 * workflow-planner-context — 差分レビューによる再計画の指摘を planner に渡す
 *
 * routing2a-fix1 項目4: 要件不備で planner へ戻した差し戻しは、その指摘が planner の
 * コンテキストに入らなければ再計画にならない。配線だけを固定する（中身は
 * workflow-review-replan-context と結合テストで検証済み）。
 */
import { describe, expect, mock, test } from 'bun:test';

const none = async () => '';
mock.module('../../config/database', () => ({ prisma: {} }));
mock.module('./workflow-stage-timing', () => ({
  observeWorkflowStage: (_t: number, _s: string, fn: () => unknown) => fn(),
}));
mock.module('./workflow-file-utils', () => ({ readWorkflowFile: async () => null }));
mock.module('./workflow-memory-context', () => ({ buildMemoryContext: none }));
mock.module('./workflow-context-snapshot', () => ({
  snapshotSection: (_t: number, _k: string, fn: () => unknown) => fn(),
}));
mock.module('./workflow-rejected-plan-context', () => ({ buildRejectedPlanContext: none }));
mock.module('./workflow-plan-revision-context', () => ({ buildPlanRevisionContext: none }));
mock.module('./workflow-case-context', () => ({ buildCaseContext: none }));
mock.module('../memory/playbook/playbook-inject', () => ({ buildPlaybookContext: none }));
mock.module('./phase-critic', () => ({
  buildCriticFeedback: none,
  buildCriticLessonsSection: none,
}));
mock.module('./subtask-split-policy', () => ({ buildSubtaskSplitDirective: () => '' }));
mock.module('./workflow-context-metrics', () => ({ recordContextMetrics: async () => {} }));
mock.module('./learning/repair-risk-tactic-section', () => ({
  buildRepairRiskTacticSection: none,
}));
mock.module('./requirement-replan-context', () => ({ buildRequirementReplanContext: none }));
mock.module('./workflow-gate-precision-context', () => ({ buildGatePrecisionContext: none }));
mock.module('./workflow-review-replan-context', () => ({
  buildReviewReplanContext: async (taskId: number, language: string) =>
    `REVIEW_REPLAN(${taskId},${language})`,
}));

const { buildPlannerContext } = await import('./workflow-planner-context');

describe('buildPlannerContext', () => {
  test('差分レビューで要件不備と判明した指摘を planner のコンテキストに入れる', async () => {
    const ctx = await buildPlannerContext(
      7,
      { title: 't', description: null },
      'ja',
      'standard',
      'TASK_INFO',
      {
        researchHeader: 'R',
        instruction: 'I',
        premortem: 'P',
        selfContainment: 'S',
      } as Parameters<typeof buildPlannerContext>[5],
      'Q',
      'STYLE',
    );
    expect(ctx).toContain('REVIEW_REPLAN(7,ja)');
  });
});
