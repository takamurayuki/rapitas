/**
 * auto-merge-watcher — pending gate test
 *
 * When the check evaluation is 'pending' (e.g. CodeQL not yet reported, task 1000) the watcher
 * must not merge, complete the task, or notify success.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// NOTE: readHeadSha/updatePrBranch are required by auto-merge-ci-failure — this
// mock replaces auto-merge-checks wholesale (bun mock.module is process-global),
// so omitting any export would crash importers.
let draftFixture: boolean | null = false;
mock.module('./auto-merge-checks', () => ({
  blockingChecks: () => new Set(['Lint Code']),
  evaluateAutoMergeChecks: () => evaluateFixture,
  readPrChecks: mock(() => Promise.resolve([{ name: 'Lint Code', bucket: 'pass' }])),
  readMergeState: mock(() => Promise.resolve('CLEAN')),
  readHeadSha: mock(() => Promise.resolve('sha-current')),
  updatePrBranch: mock(() => Promise.resolve(true)),
  // task 1099: mutable per-test so the draft-hold suite below can drive it.
  readIsDraft: mock(() => Promise.resolve(draftFixture)),
  ghPath: () => 'gh',
}));
let evaluateFixture: 'pass' | 'fail' | 'pending' | 'unknown' = 'pending';

// task 1021: the watcher now consults the pre-merge gate + drift check; both would
// otherwise shell out to gh/git. Tests drive the gate result through mockGate.
const mockGate = mock(() =>
  Promise.resolve<{ ok: boolean; reason?: string; detail?: string }>({ ok: true }),
);
const mockHandleCiFailure = mock(() => Promise.resolve());
mock.module('./auto-merge-premerge-gate', () => ({
  evaluatePreMergeGate: mockGate,
  RATCHET_CHECK_NAME: 'ratchet-check',
}));
mock.module('./auto-merge-baseline-drift', () => ({
  checkBaselineDrift: mock(() => Promise.resolve(false)),
}));
mock.module('./auto-merge-ci-failure', () => ({ handleCiFailure: mockHandleCiFailure }));

mock.module('./ci-self-repair', () => ({
  attemptCiRepair: mock(() => Promise.resolve({ bounced: false })),
  CI_REPAIR_CAUSE: 'ci_repair',
}));

mock.module('../github/conflict-task', () => ({
  fileConflictResolutionTask: mock(() => Promise.resolve({ created: false, taskId: null })),
}));

const mockResolveIntegrationId = mock(() => Promise.resolve<number | null>(1));
mock.module('../github/pr-link', () => ({
  resolveIntegrationId: mockResolveIntegrationId,
  linkAutoCreatedPr: mock(() => Promise.resolve(null)),
}));

mock.module('./auto-merge-exhaustion', () => ({
  EXHAUSTED_CAUSE: 'auto_merge_exhausted',
  resetExhaustedRecheckCooldowns: () => {},
  markExhausted: mock(() => Promise.resolve()),
  decideTerminalState: () => Promise.resolve({ terminal: false }),
  readExhaustionRecord: mock(() =>
    Promise.resolve({ exhausted: false, headSha: null, exhaustedAt: null }),
  ),
}));

const mockNotify = mock(() => Promise.resolve());
mock.module('./auto-merge-notify', () => ({
  notify: mockNotify,
}));

mock.module('./transition-recorder', () => ({
  recordTransition: mock(() => Promise.resolve()),
}));

mock.module('../../utils/database/fail-closed-count', () => ({
  countWithFailClosed: mock((p: Promise<number>) => p),
}));

const mockUpdateMany = mock(() => Promise.resolve({ count: 1 }));
const mockTaskUpdate = mock(() => Promise.resolve({}));
const mockTaskComplete = mock(() => Promise.resolve({ count: 1 }));
const mockCanContinue = mock(() => Promise.resolve(true));
mock.module('./auto-merge-task-guard', () => ({ canContinueAutoMerge: mockCanContinue }));
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
    updateMany: mockTaskComplete,
  },
};
mock.module('../../config/database', () => ({ prisma: mockPrisma }));

// NOTE (task 865): the real file moved to git-operations/pr/branch-pr-ops.ts;
// the old path here silently created a SEPARATE (never-consulted) module
// registry entry — auto-merge-watcher.ts's real import went unmocked and its
// mergePullRequest call reached the real implementation (2 fail).
const mockMerge = mock(() => Promise.resolve({ success: true, mergeStrategy: 'squash' as const }));
mock.module('../agents/orchestrator/git-operations/pr/branch-pr-ops', () => ({
  mergePullRequest: mockMerge,
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

const { AutoMergeWatcher } = await import('./auto-merge-watcher');

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
  taskId: 1000,
  taskTitle: 'test task',
  prNumber: 769,
  baseBranch: 'develop',
  cwd: '/repo',
  threshold: 0,
  completedAt: new Date(),
  mode: 'merge' as const,
};

describe('AutoMergeWatcher — pending checks', () => {
  test('does not merge, complete, or notify success while checks are pending', async () => {
    evaluateFixture = 'pending';
    mockMerge.mockClear();
    mockTaskComplete.mockClear();
    mockNotify.mockClear();
    await getProcess()(candidate, new Set(['Lint Code']));
    expect(mockMerge).not.toHaveBeenCalled();
    expect(mockTaskComplete).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

// task 1099: a draft PR (unknown verdict) must never merge or complete, even
// once CI checks are green.
describe('AutoMergeWatcher — draft PR hold', () => {
  test('does not merge or complete a draft PR even though CI checks pass', async () => {
    evaluateFixture = 'pass';
    draftFixture = true;
    mockMerge.mockClear();
    mockTaskComplete.mockClear();
    mockNotify.mockClear();
    await getProcess()(candidate, new Set(['Lint Code']));
    expect(mockMerge).not.toHaveBeenCalled();
    expect(mockTaskComplete).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test('fail-closed: an unreadable draft state (null) also holds', async () => {
    evaluateFixture = 'pass';
    draftFixture = null;
    mockMerge.mockClear();
    mockTaskComplete.mockClear();
    mockNotify.mockClear();
    await getProcess()(candidate, new Set(['Lint Code']));
    expect(mockMerge).not.toHaveBeenCalled();
    expect(mockTaskComplete).not.toHaveBeenCalled();
  });

  test('a non-draft PR with no blocking CI configured but mergeState CLEAN still holds while draft', async () => {
    // No blocking CI reported → falls to the mergeState-CLEAN fallback path,
    // which also converges on the same 'pass' checkpoint the draft hold guards.
    evaluateFixture = 'unknown';
    draftFixture = true;
    mockMerge.mockClear();
    mockTaskComplete.mockClear();
    await getProcess()(candidate, new Set(['Lint Code']));
    expect(mockMerge).not.toHaveBeenCalled();
    expect(mockTaskComplete).not.toHaveBeenCalled();
  });

  test('merges once the PR is confirmed not draft', async () => {
    evaluateFixture = 'pass';
    draftFixture = false;
    mockMerge.mockClear();
    mockTaskComplete.mockClear();
    await getProcess()(candidate, new Set(['Lint Code']));
    expect(mockMerge).toHaveBeenCalledTimes(1);
  });
});
