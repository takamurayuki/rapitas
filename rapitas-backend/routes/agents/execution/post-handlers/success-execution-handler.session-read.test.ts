/**
 * success-execution-handler.session-read.test
 *
 * The session-mode read decides whether a run is a workflow code phase. A
 * failed read used to collapse into `null`, which let an implementer run fall
 * through to the post-execution review pipeline (commit → PR → markTaskDone)
 * before its verify phase (G2 routing1 re-review 7). An unreadable session
 * must not reach that pipeline, and the mode it read is handed on so the
 * pipeline's completion write can judge the run kind.
 */
import { beforeEach, expect, mock, test } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
let sessionRead: () => Promise<{ mode: string | null } | null> = async () => ({ mode: null });
mock.module('../../../../config/database', () => ({
  prisma: {
    task: {
      findUnique: async () => ({ workflowStatus: 'in_progress', status: 'in-progress' }),
      update: async () => ({}),
      updateMany: async () => ({ count: 1 }),
    },
    agentSession: { findUnique: () => sessionRead() },
    aIAgentConfig: { findUnique: async () => ({ agentType: 'claude-code' }) },
  },
}));
mock.module('../../../../config/logger', () => ({ createLogger: () => noopLogger }));
mock.module('../shared/session-helpers', () => ({
  updateSessionStatusWithRetry: () => Promise.resolve(),
}));
const review = mock(async (_params: Record<string, unknown>) => undefined);
mock.module('./post-execution-review', () => ({ reviewAndCommitWorktree: review }));
mock.module('../shared/execution-output-validator', () => ({ detectExecutionFailures: () => [] }));
mock.module('../research/research-output-utils', () => ({ isIsolatedWorktree: () => true }));
mock.module('./dev-mode-planning-advance', () => ({
  advanceManagedPlanningPhase: () => Promise.resolve(false),
}));
mock.module('../../../../services/workflow/verifier-eligibility-settle', () => ({
  settleDeferredVerifierEligibility: async () => 'settled',
}));

const { handleSuccessfulExecution } = await import('./success-execution-handler');

const params = () => ({
  result: { success: true, output: 'done' } as Parameters<
    typeof handleSuccessfulExecution
  >[0]['result'],
  taskIdNum: 1470,
  sessionId: 41,
  configId: 1,
  taskTitle: 'implement',
  workDir: '/repo',
  executionDir: '/repo/.worktrees/task-1470',
});

beforeEach(() => {
  review.mockClear();
});

test('レビューの再現：セッションの読み取りに失敗したら post-execution review に進まない', async () => {
  sessionRead = async () => {
    throw new Error('db down');
  };
  await handleSuccessfulExecution(params());
  expect(review).not.toHaveBeenCalled();
});

test('セッションの行がないときも post-execution review に進まない', async () => {
  sessionRead = async () => null;
  await handleSuccessfulExecution(params());
  expect(review).not.toHaveBeenCalled();
});

test('読めた mode（null）を post-execution review に渡す', async () => {
  sessionRead = async () => ({ mode: null });
  await handleSuccessfulExecution(params());
  expect(review).toHaveBeenCalledTimes(1);
  expect(review.mock.calls[0]?.[0]?.sessionMode).toBeNull();
});

test('ワークフローの researcher の mode もそのまま渡す', async () => {
  sessionRead = async () => ({ mode: 'workflow-researcher' });
  await handleSuccessfulExecution(params());
  expect(review.mock.calls[0]?.[0]?.sessionMode).toBe('workflow-researcher');
});
