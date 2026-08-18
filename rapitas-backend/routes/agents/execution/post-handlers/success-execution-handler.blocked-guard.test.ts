/**
 * success-execution-handler.blocked-guard.test
 *
 * A workflow gate can block a task from inside the very request the agent made
 * (the adversarial diff review blocks during `PUT .../files/verify`). When the
 * agent's CLI then exits 0, this handler must NOT reinstate `in-progress` and
 * erase that block — doing so let the reconciler's orphan pass requeue the task
 * to `todo`, leaving todo/verify_done, a state nothing treats as actionable.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const taskFindUnique = mock(() =>
  Promise.resolve<{ workflowStatus: string | null; status: string } | null>({
    workflowStatus: 'verify_done',
    status: 'blocked',
  }),
);
const taskUpdateMany = mock(() => Promise.resolve({ count: 0 }));
const taskUpdate = mock(() => Promise.resolve({}));
const sessionFindUnique = mock(() =>
  Promise.resolve<{ mode: string | null } | null>({ mode: null }),
);
const agentConfigFindUnique = mock(() =>
  Promise.resolve<{ agentType: string | null } | null>({ agentType: 'claude-code' }),
);

mock.module('../../../../config/database', () => ({
  prisma: {
    task: { findUnique: taskFindUnique, update: taskUpdate, updateMany: taskUpdateMany },
    agentSession: { findUnique: sessionFindUnique },
    aIAgentConfig: { findUnique: agentConfigFindUnique },
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
mock.module('node:child_process', () => ({
  exec: (
    _cmd: string,
    _opts: unknown,
    cb: (err: Error | null, out: { stdout: string; stderr: string }) => void,
  ) => cb(null, { stdout: '', stderr: '' }),
}));

const { handleSuccessfulExecution } = await import('./success-execution-handler');

function params() {
  return {
    result: { success: true, output: 'done' } as Parameters<
      typeof handleSuccessfulExecution
    >[0]['result'],
    taskIdNum: 632,
    sessionId: 2655,
    configId: 1,
    taskTitle: 'ctx slimming',
    workDir: 'C:\\Projects\\rapitas',
    executionDir: 'C:\\Projects\\rapitas\\.worktrees\\task-632',
  };
}

beforeEach(() => {
  taskUpdateMany.mockReset();
  taskUpdateMany.mockResolvedValue({ count: 0 });
  taskUpdate.mockReset();
  taskFindUnique.mockReset();
  taskFindUnique.mockResolvedValue({ workflowStatus: 'verify_done', status: 'blocked' });
  sessionFindUnique.mockReset();
  sessionFindUnique.mockResolvedValue({ mode: null });
});

describe('handleSuccessfulExecution — blocked guard', () => {
  test('writes in-progress through a compare-and-swap that excludes blocked', async () => {
    await handleSuccessfulExecution(params());
    const call = taskUpdateMany.mock.calls[0]?.[0] as
      | { where: Record<string, unknown>; data: Record<string, unknown> }
      | undefined;
    expect(call).toBeDefined();
    expect(call!.data).toMatchObject({ status: 'in-progress' });
    // The CAS — not an if on an earlier read — is what makes this safe against a
    // gate that blocks concurrently with this handler.
    expect(call!.where).toMatchObject({ id: 632, status: { not: 'blocked' } });
  });

  test('does not fall back to an unconditional update when the CAS matches nothing', async () => {
    taskUpdateMany.mockResolvedValue({ count: 0 });
    await handleSuccessfulExecution(params());
    const wroteStatus = taskUpdate.mock.calls.some((c) => {
      const data = (c[0] as { data?: Record<string, unknown> } | undefined)?.data;
      return !!data && 'status' in data;
    });
    expect(wroteStatus).toBe(false);
  });

  test('still promotes a normal (unblocked) run to in-progress', async () => {
    taskFindUnique.mockResolvedValue({ workflowStatus: 'verify_done', status: 'in-progress' });
    taskUpdateMany.mockResolvedValue({ count: 1 });
    await handleSuccessfulExecution(params());
    expect(taskUpdateMany).toHaveBeenCalled();
  });
});
