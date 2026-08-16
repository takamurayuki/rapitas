/**
 * auto-merge-watcher — post-merge local mirror sync scoping
 *
 * After a successful merge the watcher flips the LOCAL GitHubPullRequest row
 * to 'merged'. GitHubPullRequest holds every repo's PRs and prNumber collides
 * across repos, so the updateMany MUST be scoped by the candidate repo's
 * integrationId — an unscoped update also flipped another project's
 * same-numbered OPEN PR to merged, removing it from ITS auto-merge candidacy
 * (task #596). When the integration cannot be resolved the sync is skipped
 * (fail-closed) but completion/notification still proceed.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// NOTE: readHeadSha/updatePrBranch are required by auto-merge-ci-failure — this
// mock replaces auto-merge-checks wholesale (bun mock.module is process-global),
// so omitting any export would crash importers.
mock.module('../../services/workflow/auto-merge-checks', () => ({
  blockingChecks: () => new Set(['Lint Code']),
  evaluateAutoMergeChecks: () => 'pass',
  readPrChecks: mock(() => Promise.resolve([{ name: 'Lint Code', bucket: 'pass' }])),
  readMergeState: mock(() => Promise.resolve('CLEAN')),
  readHeadSha: mock(() => Promise.resolve('sha-current')),
  updatePrBranch: mock(() => Promise.resolve(true)),
}));

mock.module('../../services/workflow/ci-self-repair', () => ({
  attemptCiRepair: mock(() => Promise.resolve({ bounced: false })),
  CI_REPAIR_CAUSE: 'ci_repair',
}));

mock.module('../../services/github/conflict-task', () => ({
  fileConflictResolutionTask: mock(() => Promise.resolve({ created: false, taskId: null })),
}));

const mockResolveIntegrationId = mock(() => Promise.resolve<number | null>(1));
mock.module('../../services/github/pr-link', () => ({
  resolveIntegrationId: mockResolveIntegrationId,
  linkAutoCreatedPr: mock(() => Promise.resolve(null)),
}));

mock.module('../../services/workflow/auto-merge-exhaustion', () => ({
  EXHAUSTED_CAUSE: 'auto_merge_exhausted',
  resetExhaustedRecheckCooldowns: () => {},
  markExhausted: mock(() => Promise.resolve()),
  decideTerminalState: () => Promise.resolve({ terminal: false }),
}));

const mockNotify = mock(() => Promise.resolve());
mock.module('../../services/workflow/auto-merge-notify', () => ({
  notify: mockNotify,
}));

mock.module('../../services/workflow/transition-recorder', () => ({
  recordTransition: mock(() => Promise.resolve()),
}));

mock.module('../../utils/database/fail-closed-count', () => ({
  countWithFailClosed: mock((p: Promise<number>) => p),
}));

const mockUpdateMany = mock(() => Promise.resolve({ count: 1 }));
const mockTaskUpdate = mock(() => Promise.resolve({}));
const mockPrisma = {
  workflowTransition: {
    count: mock(() => Promise.resolve(0)),
    findFirst: mock(() => Promise.resolve(null)),
    findMany: mock(() => Promise.resolve([])),
  },
  gitHubPullRequest: {
    findFirst: mock(() =>
      Promise.resolve({ title: 'PR title', headBranch: 'feature/x', baseBranch: 'develop' }),
    ),
    updateMany: mockUpdateMany,
  },
  task: {
    findUnique: mock(() => Promise.resolve({ themeId: 1 })),
    update: mockTaskUpdate,
  },
};
mock.module('../../config/database', () => ({ prisma: mockPrisma }));

mock.module('../../services/agents/orchestrator/git-operations/branch-pr-ops', () => ({
  mergePullRequest: mock(() =>
    Promise.resolve({ success: true, mergeStrategy: 'squash' as const }),
  ),
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

const { AutoMergeWatcher } = await import('../../services/workflow/auto-merge-watcher');

type ProcessFn = (
  c: {
    taskId: number;
    taskTitle: string;
    prNumber: number;
    baseBranch: string;
    cwd: string;
    threshold: number;
    completedAt: Date | null;
    mode: 'merge' | 'pr';
  },
  blocking: Set<string>,
) => Promise<void>;

function getProcess(): ProcessFn {
  const instance = AutoMergeWatcher.getInstance() as unknown as { process: ProcessFn };
  return instance.process.bind(instance);
}

const candidate = {
  taskId: 491,
  taskTitle: 'test task',
  prNumber: 6,
  baseBranch: 'develop',
  cwd: '/repo/tripla',
  threshold: 0,
  completedAt: new Date(),
  mode: 'merge' as const,
};

beforeEach(() => {
  mockResolveIntegrationId.mockClear();
  mockResolveIntegrationId.mockImplementation(() => Promise.resolve<number | null>(1));
  mockUpdateMany.mockClear();
  mockTaskUpdate.mockClear();
  mockNotify.mockClear();
});

describe('AutoMergeWatcher — post-merge local mirror sync', () => {
  test('scopes the updateMany to the candidate repo\'s integrationId', async () => {
    await getProcess()(candidate, new Set(['Lint Code']));

    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const arg = mockUpdateMany.mock.calls[0][0] as unknown as {
      where: { prNumber: number; state: string; integrationId?: number };
    };
    expect(arg.where.prNumber).toBe(6);
    expect(arg.where.state).toBe('open');
    // Without this scope another repo's open #6 would also be flipped to merged.
    expect(arg.where.integrationId).toBe(1);
  });

  test('skips the mirror sync (fail-closed) when the integration cannot be resolved, but still completes and notifies', async () => {
    mockResolveIntegrationId.mockImplementation(() => Promise.resolve<number | null>(null));

    await getProcess()(candidate, new Set(['Lint Code']));

    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockTaskUpdate).toHaveBeenCalledTimes(1); // completeTaskRow still ran
    expect(mockNotify).toHaveBeenCalledTimes(1); // auto_merge_success still sent
  });
});
