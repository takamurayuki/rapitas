/**
 * execute-setup.worktree-reuse.test
 *
 * Regression coverage for the task-513 worktree collision: a retry/rerun of
 * a task with no sessionId always took the "brand-new worktree" path even
 * when a prior session for the SAME task already had a live worktree on the
 * (deterministically-named) branch — `git worktree add` then refused because
 * that branch was already checked out elsewhere. executeSetup must now look
 * up the task's most recent prior session and reuse/recreate on it instead of
 * blindly creating a new worktree every time.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockUpsert = mock(() => Promise.resolve({ id: 1 }));
const mockSessionFindUniqueOrThrow = mock(() => Promise.resolve<Record<string, unknown>>({}));
const mockSessionCreate = mock(() => Promise.resolve({ id: 100 }));
const mockSessionFindFirst = mock(() => Promise.resolve<Record<string, unknown> | null>(null));
const mockSessionUpdate = mock(() =>
  Promise.resolve({ id: 100, branchName: null, worktreePath: null }),
);
const mockNotificationCreate = mock(() => Promise.resolve({}));
const mockTaskUpdate = mock(() => Promise.resolve({}));

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    developerModeConfig: { upsert: mockUpsert },
    agentSession: {
      findUniqueOrThrow: mockSessionFindUniqueOrThrow,
      create: mockSessionCreate,
      findFirst: mockSessionFindFirst,
      update: mockSessionUpdate,
    },
    notification: { create: mockNotificationCreate },
    task: { update: mockTaskUpdate },
  },
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

const mockCreateWorktree = mock(() => Promise.resolve('/fresh/worktree/path'));
mock.module('../../../services/agents/agent-worker-manager', () => ({
  AgentWorkerManager: {
    getInstance: () => ({ createWorktree: mockCreateWorktree }),
  },
}));

// execute-setup now calls the async generateBranchName (AI + internal
// fallback, taskId embedded inside) instead of generateFallbackBranchName.
const mockGenerateBranchName = mock(() => Promise.resolve('feature/t513-implement-task'));
mock.module('../../../utils/common/branch-name-generator', () => ({
  generateBranchName: mockGenerateBranchName,
}));

mock.module('../../../utils/database/db-helpers', () => ({
  toJsonString: (v: unknown) => JSON.stringify(v),
}));

mock.module('../../../services/agents/orchestrator/git-operations/worktree-guard', () => ({
  ensureNotPrimaryWorkTree: mock(() => Promise.resolve()),
}));

// decideWorktree is pure and already unit-tested (worktree-usable.test.ts) —
// mock it here so this test controls the decision directly instead of also
// needing to fake filesystem existence.
const mockDecideWorktree = mock(() => 'fallback' as 'reuse' | 'recreate' | 'fallback');
mock.module('../../../services/agents/orchestrator/git-operations/worktree-usable', () => ({
  decideWorktree: mockDecideWorktree,
}));

const { executeSetup } = await import('./execute-setup');

beforeEach(() => {
  mockUpsert.mockReset().mockResolvedValue({ id: 1 });
  mockSessionFindUniqueOrThrow.mockReset();
  mockSessionCreate.mockReset().mockResolvedValue({ id: 100 });
  mockSessionFindFirst.mockReset().mockResolvedValue(null);
  mockSessionUpdate
    .mockReset()
    .mockResolvedValue({ id: 100, branchName: null, worktreePath: null });
  mockNotificationCreate.mockReset().mockResolvedValue({});
  mockTaskUpdate.mockReset().mockResolvedValue({});
  mockCreateWorktree.mockReset().mockResolvedValue('/fresh/worktree/path');
  mockGenerateBranchName.mockReset().mockResolvedValue('feature/t513-implement-task');
  mockDecideWorktree.mockReset().mockReturnValue('fallback');
});

function baseParams(overrides: Partial<Parameters<typeof executeSetup>[0]> = {}) {
  return {
    taskIdNum: 513,
    taskTitle: 'implement task 513',
    existingConfig: null,
    workDir: '/test/repo',
    ...overrides,
  };
}

describe('executeSetup — worktree reuse on retry (task 513 regression)', () => {
  test('reuses the recorded worktree outright when a prior session has one that is still usable', async () => {
    mockSessionFindFirst.mockResolvedValue({
      worktreePath: '/test/repo/.worktrees/task-513-83e6b1c6',
      branchName: 'feature/implement-task-task-513',
    });
    mockDecideWorktree.mockReturnValue('reuse');

    const result = await executeSetup(baseParams());

    expect(result.worktreePath).toBe('/test/repo/.worktrees/task-513-83e6b1c6');
    expect(result.finalBranchName).toBe('feature/implement-task-task-513');
    // The whole point: no NEW worktree is created when reusing.
    expect(mockCreateWorktree).not.toHaveBeenCalled();
  });

  test('looks up the prior session excluding the just-created one, scoped to this task', async () => {
    mockSessionCreate.mockResolvedValue({ id: 777 });
    mockDecideWorktree.mockReturnValue('fallback');

    await executeSetup(baseParams());

    expect(mockSessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { configId: 1, id: { not: 777 }, worktreePath: { not: null } },
        orderBy: { id: 'desc' },
      }),
    );
  });

  test('regression: a dead session from a failed retry (null worktreePath) must not shadow the last successful one', async () => {
    // Reproduces the round-2 task-513 failure: findFirst's own `where` filter
    // is what excludes the dead session, so this test locks that the filter
    // is actually present rather than re-deriving the SQL-level behavior.
    mockSessionFindFirst.mockImplementation((args: unknown) => {
      const where = (args as { where?: { worktreePath?: { not: null } } })?.where;
      // Only "return" a row when the caller filtered out null-worktreePath
      // sessions — mirrors what a real `worktreePath: { not: null }` clause
      // would do against a table containing both a dead and a live session.
      if (where?.worktreePath?.not === null) {
        return Promise.resolve({
          worktreePath: '/test/repo/.worktrees/task-513-83e6b1c6',
          branchName: 'feature/implement-task-task-513',
        });
      }
      return Promise.resolve(null);
    });
    mockDecideWorktree.mockReturnValue('reuse');

    const result = await executeSetup(baseParams());

    expect(result.worktreePath).toBe('/test/repo/.worktrees/task-513-83e6b1c6');
    expect(mockCreateWorktree).not.toHaveBeenCalled();
  });

  test('recreates on the recorded branch name (not a fresh regeneration) when the worktree is a phantom', async () => {
    mockSessionFindFirst.mockResolvedValue({
      worktreePath: '/gone/task-513-old',
      branchName: 'feature/implement-task-task-513',
    });
    mockDecideWorktree.mockReturnValue('recreate');

    await executeSetup(baseParams());

    expect(mockCreateWorktree).toHaveBeenCalledWith(
      '/test/repo',
      'feature/implement-task-task-513',
      513,
      null,
      null,
    );
    // The generator is only a last resort — it must not run
    // when a recorded branch name is already known.
    expect(mockGenerateBranchName).not.toHaveBeenCalled();
  });

  test('creates a brand-new worktree when the task has no prior session at all', async () => {
    mockSessionFindFirst.mockResolvedValue(null);
    mockDecideWorktree.mockReturnValue('fallback');

    const result = await executeSetup(baseParams());

    expect(mockCreateWorktree).toHaveBeenCalledTimes(1);
    expect(result.finalBranchName).toBe('feature/t513-implement-task');
    // Generator receives title, description, and the numeric taskId (which it
    // embeds as the t<taskId>- marker internally).
    expect(mockGenerateBranchName).toHaveBeenCalledWith('implement task 513', undefined, 513);
  });

  test('skips the prior-session lookup entirely when the caller passes an explicit branchName', async () => {
    await executeSetup(baseParams({ branchName: 'feature/custom-override' }));

    expect(mockSessionFindFirst).not.toHaveBeenCalled();
    expect(mockCreateWorktree).toHaveBeenCalledWith(
      '/test/repo',
      'feature/custom-override',
      513,
      null,
      null,
    );
  });

  test('uses the continuing session itself as the recorded worktree when sessionId is provided', async () => {
    mockSessionFindUniqueOrThrow.mockResolvedValue({
      id: 42,
      worktreePath: '/test/repo/.worktrees/task-513-existing',
      branchName: 'feature/implement-task-task-513',
    });
    mockDecideWorktree.mockReturnValue('reuse');

    const result = await executeSetup(baseParams({ sessionId: 42 }));

    expect(mockSessionFindFirst).not.toHaveBeenCalled();
    expect(result.worktreePath).toBe('/test/repo/.worktrees/task-513-existing');
    expect(mockCreateWorktree).not.toHaveBeenCalled();
  });
});
