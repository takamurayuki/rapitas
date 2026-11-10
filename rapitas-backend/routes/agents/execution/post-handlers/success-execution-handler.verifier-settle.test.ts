/**
 * success-execution-handler.verifier-settle.test
 *
 * On the manual execute route there is no CLI epilogue. When a verifier run
 * ends here, the verify.md save may have deferred completion because the
 * verifier had not reported its model yet; the handler must hand that deferral
 * to the settle step. It skips the step for an implementer run (G2 routing1
 * re-review item 5).
 */
import { beforeEach, expect, mock, test } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
let mode: string | null = 'workflow-verifier';
mock.module('../../../../config/database', () => ({
  prisma: {
    task: {
      findUnique: async () => ({ workflowStatus: 'verify_done', status: 'in-progress' }),
      update: async () => ({}),
      updateMany: async () => ({ count: 1 }),
    },
    agentSession: { findUnique: async () => ({ mode }) },
    aIAgentConfig: { findUnique: async () => ({ agentType: 'claude-code' }) },
  },
}));
mock.module('../../../../config/logger', () => ({ createLogger: () => noopLogger }));
mock.module('../shared/session-helpers', () => ({
  updateSessionStatusWithRetry: () => Promise.resolve(),
}));
mock.module('./post-execution-review', () => ({
  reviewAndCommitWorktree: () => Promise.resolve(),
}));
mock.module('../shared/execution-output-validator', () => ({ detectExecutionFailures: () => [] }));
mock.module('../research/research-output-utils', () => ({ isIsolatedWorktree: () => true }));
mock.module('./dev-mode-planning-advance', () => ({
  advanceManagedPlanningPhase: () => Promise.resolve(false),
}));
const settle = mock(async (_taskId: number, _sessionId?: number) => 'held' as const);
mock.module('../../../../services/workflow/verifier-eligibility-settle', () => ({
  settleDeferredVerifierEligibility: settle,
}));

const { handleSuccessfulExecution } = await import('./success-execution-handler');

const params = () => ({
  result: { success: true, output: 'done' } as Parameters<
    typeof handleSuccessfulExecution
  >[0]['result'],
  taskIdNum: 1471,
  sessionId: 31,
  configId: 1,
  taskTitle: 'verify',
  workDir: '/repo',
  executionDir: '/repo/.worktrees/task-1471',
});

beforeEach(() => {
  settle.mockClear();
});

test.each(['workflow-verifier', 'workflow-auto_verifier'])(
  '%s の実行が終わったら、先送りされた適格性判定を確定させる',
  async (m) => {
    mode = m;
    await handleSuccessfulExecution(params());
    expect(settle).toHaveBeenCalledWith(1471, 31);
  },
);

test('implementer の実行では確定処理を呼ばない', async () => {
  mode = 'workflow-implementer';
  await handleSuccessfulExecution(params());
  expect(settle).not.toHaveBeenCalled();
});
