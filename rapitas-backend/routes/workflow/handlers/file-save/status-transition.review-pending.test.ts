/**
 * status-transition.review-pending.test
 *
 * A passing verify.md save whose diff still needs the adversarial review does
 * not write verify_done: advanceReviewedVerify is not called and the
 * `file_saved:verify` row records the unchanged status (task 1538 受入条件4).
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
const mockTaskUpdate = mock(async () => ({}));
mock.module('../../../../config', () => ({
  prisma: {
    task: {
      update: mockTaskUpdate,
      findUnique: mock(async () => ({ githubPrId: null, updatedAt: new Date(0) })),
    },
    workflowTransition: { findFirst: mock(async () => null) },
  },
}));
mock.module('../../../../services/workflow/completion-gate', () => ({
  researchConcludesNoChange: () => false,
}));
const transitions: Array<{ cause: string; fromStatus: string | null; toStatus: string }> = [];
mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: mock(async (args: (typeof transitions)[number]) => {
    transitions.push(args);
  }),
}));
mock.module('../../../../services/workflow/workflow-invariants', () => ({
  checkWorkflowInvariants: mock(async () => []),
}));
mock.module('./shared', () => ({
  markLatestExecutionFailed: mock(async () => {}),
  wasNonConvergenceCutoffJustRecorded: mock(async () => false),
}));
mock.module('../../../../services/workflow/phase-output-validator', () => ({
  validateVerify: () => ({ ok: true, severity: 0, summary: '', missingSections: [] }),
}));
const receipt = { taskId: 1538 };
mock.module('../../../../services/workflow/requirement-replan-service', () => ({
  attemptRequirementReplan: async () => ({
    committed: false,
    reason: 'no_mismatch',
    completionReceipt: receipt,
  }),
}));
const advanceVerify = mock(async (_db: unknown, r: unknown) => r);
mock.module('../../../../services/workflow/requirement-replan-commit', () => ({
  advanceReviewedVerify: advanceVerify,
}));
mock.module('../../../../services/workflow/verify-self-repair', () => ({
  attemptVerifyRepair: async () => ({ bounced: false }),
}));
let pending = true;
const admitMock = mock(async (p: { completionReceipt: unknown }) => ({
  completionReceipt: p.completionReceipt,
  reviewPending: pending,
  reviewFromStatus: pending ? 'in_progress' : undefined,
}));
mock.module('./verify-review-admission', () => ({ admitVerifyForReview: admitMock }));

const { computeAndApplyStatusTransition } = await import('./status-transition');

beforeEach(() => {
  transitions.length = 0;
  advanceVerify.mockClear();
  admitMock.mockClear();
  pending = true;
});

describe('computeAndApplyStatusTransition — diff review pending', () => {
  test('レビュー待ちなら verify_done を書かず、保存の遷移は in_progress のまま記録する', async () => {
    const result = await computeAndApplyStatusTransition({
      taskId: 1538,
      fileType: 'verify',
      currentStatus: 'in_progress',
      savedContent: 'verify body',
    });
    expect(advanceVerify).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(admitMock).toHaveBeenCalledTimes(1);
    expect(result.newStatus).toBe('verify_done');
    expect(result.admission?.reviewPending).toBe(true);
    expect(result.completionReceipt).toEqual(receipt);
    const saved = transitions.find((t) => t.cause === 'file_saved:verify');
    expect(saved).toMatchObject({ fromStatus: 'in_progress', toStatus: 'in_progress' });
    expect(transitions.some((t) => t.toStatus === 'verify_done')).toBe(false);
  });

  test('レビュー待ちでなければ保存の遷移は verify_done を記録する', async () => {
    pending = false;
    const result = await computeAndApplyStatusTransition({
      taskId: 1538,
      fileType: 'verify',
      currentStatus: 'in_progress',
      savedContent: 'verify body',
    });
    expect(result.admission?.reviewPending).toBe(false);
    const saved = transitions.find((t) => t.cause === 'file_saved:verify');
    expect(saved?.toStatus).toBe('verify_done');
  });
});
