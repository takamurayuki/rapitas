/**
 * auto-merge-watcher — fail-state conflict handling
 *
 * A PR can be simultaneously CI-red AND DIRTY (merge conflict) when its
 * branch forked from a base tip that has since moved on: it's both missing
 * upstream fixes (real CI failures unrelated to the task's own diff) and
 * unable to fast-forward merge. Before this fix, the `state === 'fail'`
 * branch went straight to CI self-repair and never checked for a conflict,
 * burning the bounded repair budget on an unfixable "stale branch" build
 * error and parking with a misleading "CI failed" reason that omitted the
 * real, fixable cause (see PR #326 in project history).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockReadPrChecks = mock(() => Promise.resolve([{ name: 'Lint Code', bucket: 'fail' }]));
const mockReadMergeState = mock(() =>
  Promise.resolve<'DIRTY' | 'CLEAN' | 'BLOCKED' | 'UNKNOWN'>('DIRTY'),
);
// NOTE: readHeadSha/updatePrBranch are required by auto-merge-ci-failure (the
// extracted fail-state orchestrator) — this mock replaces the module wholesale,
// so omitting them would crash with "undefined is not a function".
const mockReadHeadSha = mock(() => Promise.resolve('sha-current'));
const mockUpdatePrBranch = mock(() => Promise.resolve(true));
mock.module('../../services/workflow/auto-merge-checks', () => ({
  blockingChecks: () => new Set(['Lint Code']),
  evaluateAutoMergeChecks: () => 'fail',
  readPrChecks: mockReadPrChecks,
  readMergeState: mockReadMergeState,
  readHeadSha: mockReadHeadSha,
  updatePrBranch: mockUpdatePrBranch,
}));

const mockAttemptCiRepair = mock(() => Promise.resolve({ bounced: false }));
mock.module('../../services/workflow/ci-self-repair', () => ({
  attemptCiRepair: mockAttemptCiRepair,
  CI_REPAIR_CAUSE: 'ci_repair',
}));

const mockFileConflictResolutionTask = mock(() => Promise.resolve({ created: true, taskId: 999 }));
mock.module('../../services/github/conflict-task', () => ({
  fileConflictResolutionTask: mockFileConflictResolutionTask,
}));

const mockResolveIntegrationId = mock(() => Promise.resolve(1));
mock.module('../../services/github/pr-link', () => ({
  resolveIntegrationId: mockResolveIntegrationId,
}));

const mockMarkExhausted = mock(() => Promise.resolve());
mock.module('../../services/workflow/auto-merge-exhaustion', () => ({
  EXHAUSTED_CAUSE: 'auto_merge_exhausted',
  resetExhaustedRecheckCooldowns: () => {},
  markExhausted: mockMarkExhausted,
  decideTerminalState: () => Promise.resolve({ terminal: false }),
}));

const mockNotify = mock(() => Promise.resolve());
mock.module('../../services/workflow/auto-merge-notify', () => ({
  notify: mockNotify,
}));

const mockRecordTransition = mock(() => Promise.resolve());
mock.module('../../services/workflow/transition-recorder', () => ({
  recordTransition: mockRecordTransition,
}));

const mockCountWithFailClosed = mock((p: Promise<number>) => p);
mock.module('../../utils/database/fail-closed-count', () => ({
  countWithFailClosed: mockCountWithFailClosed,
}));

const mockPrisma = {
  workflowTransition: {
    count: mock(() => Promise.resolve(0)),
    // Defaults mean "no prior update-branch attempt / no prior ci_repair" so the
    // pre-existing DIRTY/BLOCKED expectations below are unaffected.
    findFirst: mock(() => Promise.resolve(null)),
    findMany: mock(() => Promise.resolve([])),
  },
  gitHubPullRequest: {
    findFirst: mock(() =>
      Promise.resolve({ title: 'PR title', headBranch: 'feature/x', baseBranch: 'develop' }),
    ),
    updateMany: mock(() => Promise.resolve({ count: 0 })),
  },
  task: {
    findUnique: mock(() => Promise.resolve({ themeId: 1 })),
    update: mock(() => Promise.resolve({})),
  },
};
mock.module('../../config/database', () => ({ prisma: mockPrisma }));

const mockMergePullRequest = mock(() => Promise.resolve({ success: false, retriable: false }));
mock.module('../../services/agents/orchestrator/git-operations/branch-pr-ops', () => ({
  mergePullRequest: mockMergePullRequest,
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
  taskId: 501,
  taskTitle: 'test task',
  prNumber: 326,
  baseBranch: 'develop',
  cwd: '/repo',
  threshold: 0,
  completedAt: new Date(),
  mode: 'merge' as const,
};

beforeEach(() => {
  mockAttemptCiRepair.mockClear();
  mockFileConflictResolutionTask.mockClear();
  mockReadMergeState.mockClear();
  mockMarkExhausted.mockClear();
  mockReadHeadSha.mockClear();
  mockUpdatePrBranch.mockClear();
  mockPrisma.workflowTransition.findFirst.mockClear();
  mockPrisma.workflowTransition.findMany.mockClear();
});

describe('AutoMergeWatcher — fail state with a real merge conflict', () => {
  test('files a conflict-resolution task instead of attempting CI self-repair when DIRTY', async () => {
    mockReadMergeState.mockResolvedValue('DIRTY');
    const process = getProcess();

    await process(candidate, new Set(['Lint Code']));

    expect(mockFileConflictResolutionTask).toHaveBeenCalledTimes(1);
    expect(mockAttemptCiRepair).not.toHaveBeenCalled();
  });

  test('falls through to CI self-repair as before when NOT conflicting', async () => {
    mockReadMergeState.mockResolvedValue('BLOCKED');
    const process = getProcess();

    await process(candidate, new Set(['Lint Code']));

    expect(mockFileConflictResolutionTask).not.toHaveBeenCalled();
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });
});
