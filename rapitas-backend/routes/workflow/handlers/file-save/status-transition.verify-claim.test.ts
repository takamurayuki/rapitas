/**
 * status-transition.verify-claim.test
 *
 * The save path looks up the job a verify.md's claim cites (by task id and the
 * saved content) and hands it to validateVerify as the 3rd argument (F7).
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const mockPrisma = {
  task: {
    update: mock(() => Promise.resolve({})),
    findUnique: mock(() => Promise.resolve({ githubPrId: null, updatedAt: new Date(0) })),
  },
  workflowTransition: { findFirst: mock(() => Promise.resolve(null)) },
};
mock.module('../../../../config', () => ({ prisma: mockPrisma }));
mock.module('../../../../services/workflow/completion-gate', () => ({
  researchConcludesNoChange: () => false,
}));
mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: mock(() => Promise.resolve()),
}));
mock.module('../../../../services/workflow/workflow-invariants', () => ({
  checkWorkflowInvariants: mock(() => Promise.resolve([])),
}));
mock.module('./shared', () => ({
  markLatestExecutionFailed: mock(() => Promise.resolve()),
  wasNonConvergenceCutoffJustRecorded: mock(() => Promise.resolve(false)),
}));
mock.module('../../../../services/workflow/plan-for-verify', () => ({
  loadPlanContentForVerify: async () => 'PLAN',
}));

const MEASURED = { job: { status: 'completed', ok: true, revision: 'abc1234' } };
const loadMeasuredVerification = mock(async (_taskId: number, _content: string) => MEASURED);
mock.module('../../../../services/workflow/verify-claim-loader', () => ({
  loadMeasuredVerification,
}));

const mockValidateVerify = mock(() => ({
  ok: true,
  missingSections: [] as string[],
  severity: 0,
  summary: '',
}));
mock.module('../../../../services/workflow/phase-output-validator', () => ({
  validateVerify: mockValidateVerify,
}));
mock.module('../../../../services/workflow/requirement-replan-commit', () => ({
  advanceReviewedVerify: mock(async (_db: unknown, receipt: unknown) => receipt),
}));
mock.module('../../../../services/workflow/requirement-replan-service', () => ({
  attemptRequirementReplan: mock(async () => ({
    committed: false,
    reason: 'no_mismatch',
    completionReceipt: { taskId: 715 },
  })),
}));
mock.module('../../../../services/workflow/verify-self-repair', () => ({
  attemptVerifyRepair: mock(() => Promise.resolve({ bounced: false })),
}));

const { computeAndApplyStatusTransition } = await import('./status-transition');

describe('computeAndApplyStatusTransition — verify-claim hand-off', () => {
  beforeEach(() => {
    loadMeasuredVerification.mockClear();
    mockValidateVerify.mockClear();
  });

  test('passes the measured job of the saved verify.md to validateVerify', async () => {
    await computeAndApplyStatusTransition({
      taskId: 715,
      fileType: 'verify',
      currentStatus: 'in_progress',
      savedContent: 'verify body',
    });
    expect(loadMeasuredVerification).toHaveBeenCalledWith(715, 'verify body');
    expect(mockValidateVerify).toHaveBeenCalledWith('verify body', 'PLAN', MEASURED);
  });
});
