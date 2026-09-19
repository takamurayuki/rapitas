/**
 * continue-post-handler.test
 *
 * Coverage for handleContinueResult's PR auto-link step (task 951):
 * - success path calls detectAndLinkContinuationPr before worktree removal
 * - a rejected/thrown detection promise never propagates (existing flow
 *   — status update, worktree cleanup — still completes)
 * - the failure branch (result.success=false) never calls detection at all
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  }),
}));

const steps: string[] = [];

const taskUpdate = mock(() => Promise.resolve({}));
const agentSessionUpdate = mock(() => Promise.resolve({}));
mock.module('../../../../config/database', () => ({
  prisma: {
    task: { update: taskUpdate },
    agentSession: { update: agentSessionUpdate },
  },
}));

const applyTaskStatusFromWorkflow = mock(() => {
  steps.push('status');
  return Promise.resolve();
});
mock.module('../../../../services/workflow/apply-task-status-from-workflow', () => ({
  applyTaskStatusFromWorkflow,
}));

const updateSessionStatusWithRetry = mock(() => {
  steps.push('session-status');
  return Promise.resolve();
});
mock.module('../shared/session-helpers', () => ({ updateSessionStatusWithRetry }));

mock.module('../shared/execution-lock', () => ({
  releaseTaskExecutionLock: mock(() => {}),
  acquireTaskExecutionLock: mock(() => true),
}));

mock.module('../../../../services/agents/agent-worker/shutdown-error', () => ({
  isShutdownError: () => false,
}));

let detectResult: number | null | 'reject' = null;
const detectAndLinkContinuationPr = mock(() => {
  steps.push('detect-pr');
  if (detectResult === 'reject') return Promise.reject(new Error('gh boom'));
  return Promise.resolve(detectResult);
});
mock.module('../../../../services/github/continuation-pr-detect', () => ({
  detectAndLinkContinuationPr,
}));

const removeWorktree = mock(() => {
  steps.push('remove-worktree');
  return Promise.resolve(true);
});
mock.module('../../../../services/agents/agent-worker-manager', () => ({
  AgentWorkerManager: { getInstance: () => ({ removeWorktree }) },
}));

const { handleContinueResult } = await import('./continue-post-handler');

beforeEach(() => {
  steps.length = 0;
  detectResult = null;
  taskUpdate.mockClear();
  agentSessionUpdate.mockClear();
  applyTaskStatusFromWorkflow.mockClear();
  updateSessionStatusWithRetry.mockClear();
  detectAndLinkContinuationPr.mockClear();
  removeWorktree.mockClear();
});

const baseParams = {
  result: { success: true },
  taskId: 951,
  taskTitle: 'Fix PR linking',
  targetSessionId: 1,
  branchName: 'bugfix/t951-update-agent',
  workingDirectory: '/repo',
  executionDir: '/repo/.worktrees/task-951',
};

describe('handleContinueResult — success path', () => {
  it('detects/links a PR before removing the worktree, in status -> detect -> remove order', async () => {
    detectResult = 777;

    await handleContinueResult(baseParams);

    expect(steps).toEqual(['status', 'session-status', 'detect-pr', 'remove-worktree']);
    expect(detectAndLinkContinuationPr).toHaveBeenCalledTimes(1);
    const call = detectAndLinkContinuationPr.mock.calls[0][1] as {
      taskId: number;
      branchName: string | null;
    };
    expect(call).toMatchObject({ taskId: 951, branchName: 'bugfix/t951-update-agent' });
  });

  it('swallows a detection failure and still completes worktree cleanup', async () => {
    detectResult = 'reject';

    await expect(handleContinueResult(baseParams)).resolves.toBeUndefined();

    expect(steps).toEqual(['status', 'session-status', 'detect-pr', 'remove-worktree']);
  });

  it('completes normally when no PR is found (detection returns null)', async () => {
    detectResult = null;

    await handleContinueResult(baseParams);

    expect(steps).toContain('remove-worktree');
  });
});

describe('handleContinueResult — failure path', () => {
  it('never calls PR detection when the continuation failed', async () => {
    await handleContinueResult({
      ...baseParams,
      result: { success: false, errorMessage: 'agent crashed' },
    });

    expect(detectAndLinkContinuationPr).not.toHaveBeenCalled();
    expect(taskUpdate).toHaveBeenCalledTimes(1);
  });
});
