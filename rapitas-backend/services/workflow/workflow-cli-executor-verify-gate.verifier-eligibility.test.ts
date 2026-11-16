/**
 * workflow-cli-executor-verify-gate.verifier-eligibility テスト
 *
 * CLI/オーケストレータの verify エピローグで、検証役の適格性判定を PR の有無に
 * かかわらず必ず通すことを、実物の verifier-eligibility を通して固定する（G2
 * routing1 再レビュー指摘3）。以前は判定が `!prSatisfied` の中（fallback 陪審
 * ゲート）にしかなく、既存 PR の再検証では不適格な検証役でも完了へ進めた。
 * エピローグは実行後なので、実モデル未報告は未確認として保留する（指摘5）。
 */
import { beforeEach, expect, mock, test } from 'bun:test';

const noopLogger = { info() {}, error() {}, warn() {}, debug() {}, fatal() {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
const receipt = { taskId: 1471 };
mock.module('./requirement-replan-service', () => ({
  attemptRequirementReplan: async () => ({
    committed: false,
    reason: 'no_mismatch',
    completionReceipt: receipt,
  }),
}));
const completeReview = mock(async (_db: unknown, _r: unknown, _c: unknown) => ({
  committed: true,
  reason: 'verify_passed',
}));
mock.module('./requirement-replan-commit', () => ({
  completeReviewedTask: completeReview,
  assertReviewedTaskCurrent: async () => undefined,
}));
mock.module('../../config', () => ({ prisma: { task: { update: async () => ({}) } } }));
mock.module('./transition-recorder', () => ({ recordTransition: async () => undefined }));
mock.module('./workflow-file-utils', () => ({ readWorkflowFile: async () => '# verify' }));
mock.module('./completion-gate', () => ({
  evaluateCompletionGate: async () => ({ allow: true, reason: 'real diff' }),
}));
mock.module('./durable-blocked-write', () => ({ writeBlockedStatusDurable: async () => {} }));
mock.module('./verify-self-repair', () => ({
  hasFreshVerifyRejection: async () => false,
  attemptVerifyRepair: async () => ({ bounced: false, stale: false }),
}));
const autoCommit = mock(async () => ({}));
mock.module('../../routes/workflow/workflow-auto-commit', () => ({
  performAutoCommitAndPR: autoCommit,
  isNoChangeCompletion: () => false,
}));
let prLinked = true;
mock.module('./workflow-cli-executor-helpers', () => ({
  taskHasLinkedPr: async () => prLinked,
  wasVerifyValidationFailureJustRecorded: async () => false,
}));
mock.module('./verify-settle-artifact-recovery', () => ({
  isAwaitingRequiredMerge: async () => false,
  isAwaitingStagedPrCompletion: async () => false,
}));
mock.module('./required-merge-hold', () => ({
  holdForRequiredMerge: async () => true,
  AWAITING_REQUIRED_MERGE_CAUSE: 'verify_awaiting_required_merge',
}));
mock.module('./pr-in-flight-wait', () => ({
  waitForInFlightPr: async () => true,
  PR_CREATION_IN_FLIGHT_ERROR: 'in flight',
}));
const fallbackJury = mock(async (_p: unknown) => ({ stop: false }));
mock.module('./verify-fallback-jury-gate', () => ({ runFallbackJuryGate: fallbackJury }));

// Real verifier-eligibility, fed by these execution records.
let verifierModel: string | null = 'claude-opus-5-5';
let dbDown = false;
mock.module('../../config/database', () => ({
  prisma: {
    agentExecution: {
      findFirst: async () => {
        if (dbDown) throw new Error('db down');
        return {
          modelName: verifierModel,
          status: 'post_processing',
          session: { mode: 'workflow-verifier' },
        };
      },
      findMany: async () => [{ modelName: 'claude-opus-5-5' }],
    },
    workflowRoleConfig: { findFirst: async () => ({ modelId: 'claude-opus-5-5' }) },
  },
}));
const holdForHumanReview = mock(
  async (_p: Record<string, unknown>): Promise<'held' | 'cas_lost'> => 'held',
);
mock.module('./review-hold', () => ({ holdForHumanReview }));

const { resolveVerifyPhaseStatus } = await import('./workflow-cli-executor-verify-gate');

const params = () =>
  ({
    taskId: 1471,
    transition: { role: 'verifier', outputFile: 'verify', nextStatus: 'completed' },
    session: { id: 9 },
    currentWfStatus: 'in_progress',
    fileContent: '# 検証結果',
    validation: { ok: true, severity: 0, summary: 'ok', missingSections: [] },
    resolvedWorktreePath: '/wt',
  }) as unknown as Parameters<typeof resolveVerifyPhaseStatus>[0];

beforeEach(() => {
  verifierModel = 'claude-opus-5-5';
  dbDown = false;
  prLinked = true;
  completeReview.mockClear();
  fallbackJury.mockClear();
  autoCommit.mockClear();
  holdForHumanReview.mockReset().mockResolvedValue('held');
});

test('既存 PR があっても、不適格な検証役（Haiku）の判定では完了させず保留する', async () => {
  verifierModel = 'claude-haiku-5-5';
  expect(await resolveVerifyPhaseStatus(params())).toBe('verify_done');
  expect(completeReview).not.toHaveBeenCalled();
  expect(holdForHumanReview).toHaveBeenCalledTimes(1);
  expect(holdForHumanReview.mock.calls[0][0].source).toBe('cli_epilogue');
  expect(holdForHumanReview.mock.calls[0][0].fromStatus).toBe('in_progress');
});

test('既存 PR があっても、実行後に実モデル未報告なら（設定が Opus でも）保留する', async () => {
  verifierModel = null;
  expect(await resolveVerifyPhaseStatus(params())).toBe('verify_done');
  expect(completeReview).not.toHaveBeenCalled();
  expect(holdForHumanReview).toHaveBeenCalledTimes(1);
});

test('既存 PR があっても、記録が読めなければ完了させない', async () => {
  dbDown = true;
  expect(await resolveVerifyPhaseStatus(params())).toBe('verify_done');
  expect(completeReview).not.toHaveBeenCalled();
});

test('PR がない場合も、陪審・commit/PR の前で止める', async () => {
  prLinked = false;
  verifierModel = 'claude-haiku-5-5';
  expect(await resolveVerifyPhaseStatus(params())).toBe('verify_done');
  expect(fallbackJury).not.toHaveBeenCalled();
  expect(autoCommit).not.toHaveBeenCalled();
});

test('適格な検証役なら、既存 PR の再検証はこれまでどおり完了する', async () => {
  expect(await resolveVerifyPhaseStatus(params())).toBe('completed');
  expect(holdForHumanReview).not.toHaveBeenCalled();
});
