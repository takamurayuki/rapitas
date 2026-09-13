/**
 * workflow-auto-commit テスト
 *
 * Auto-PR作成失敗時のログ出力を検証する(task 687):
 * - 失敗理由が `err`(Error)キーで渡され、log-format-parser が抽出できること
 * - `isNoChangeCompletion` が真の「既に実装済み・変更なし」ケースは
 *   ERRORではなくWARNで記録され、同一の汎用バグとして再起票されないこと
 * - 認証エラー等の本当の失敗はERRORのまま維持されること
 */
import { describe, expect, test, mock } from 'bun:test';

type LogCall = [Record<string, unknown>, string];
const errorLogCalls: LogCall[] = [];
const warnLogCalls: LogCall[] = [];
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    debug: () => {},
    warn: (obj: Record<string, unknown>, msg: string) => {
      warnLogCalls.push([obj, msg]);
    },
    error: (obj: Record<string, unknown>, msg: string) => {
      errorLogCalls.push([obj, msg]);
    },
  }),
}));

const mockPrisma = {
  agentExecutionConfig: {
    findUnique: mock(() =>
      Promise.resolve({
        autoCommit: true,
        autoCreatePR: true,
        autoMergePR: false,
        workingDirectory: 'C:\\work\\project',
        targetBranch: null,
      }),
    ),
  },
  task: {
    findUnique: mock(() =>
      Promise.resolve({
        id: 687,
        title: 'テストタスク',
        theme: { workingDirectory: 'C:\\work\\project', defaultBranch: 'develop' },
        developerModeConfig: {
          agentSessions: [{ id: 1, branchName: 'feature/t687', worktreePath: null }],
        },
      }),
    ),
  },
  agentSession: { update: mock(() => Promise.resolve({})) },
};
mock.module('../../config', () => ({
  prisma: mockPrisma,
  getProjectRoot: () => 'C:\\Projects\\other',
}));

// Publication cancellation guard (task 895). Default: no stop on record, so the
// pre-existing cases below are unaffected; the cancellation suite flips
// `cancelAtStep` to assert each boundary withholds the steps after it.
let cancelAtStep: string | null = null;
const publicationAbortedCalls: string[] = [];
mock.module('../../services/workflow/publication-cancellation-guard', () => ({
  PUBLICATION_CANCELLED_ERROR: 'タスクが停止されたため、公開処理を中断しました。',
  publicationAborted: (_taskId: number, step: string) => {
    publicationAbortedCalls.push(step);
    return Promise.resolve(cancelAtStep === step);
  },
}));

mock.module('../../services/workflow/automation-policy', () => ({
  resolveAutomationPolicy: () =>
    Promise.resolve({ autoCommit: true, autoCreatePR: true, autoMergePR: false }),
}));

const verificationGateMock = mock(
  async (): Promise<
    import('../../services/agents/verification/verification-gate').GateOutcome
  > => ({ ok: true, result: null }),
);
mock.module('../../services/agents/verification/verification-gate', () => ({
  runVerificationGate: verificationGateMock,
}));

// One mutable fixture per test drives createPullRequest's outcome and the
// commit's filesChanged count (both feed isNoChangeCompletion's classifier).
let prResultFixture: { success: boolean; error: string; prNumber?: number } = {
  success: false,
  error: 'no commits between develop and feature/t687',
};
let filesChangedFixture = 0;
let removeWorktreeFixture = true;
mock.module('../../services/agents/agent-orchestrator', () => ({
  AgentOrchestrator: {
    getInstance: () => ({
      createBranch: () => Promise.resolve(),
      createCommit: () => {
        createCommitCalls++;
        return Promise.resolve({
          hash: 'abc123',
          branch: 'feature/t687',
          filesChanged: filesChangedFixture,
          additions: 0,
          deletions: 0,
          alreadyCommitted: false,
        });
      },
      createPullRequest: () => {
        createPullRequestCalls++;
        return Promise.resolve(prResultFixture);
      },
      removeWorktree: () => {
        removeWorktreeCalls++;
        return Promise.resolve(removeWorktreeFixture);
      },
    }),
  },
}));

mock.module('./workflow-activity-logger', () => ({
  logAutoCommit: () => Promise.resolve(),
  logAutoPR: () => Promise.resolve(),
}));

mock.module('../../services/github/pr-link', () => ({
  linkAutoCreatedPr: () => Promise.resolve(),
}));

mock.module('../../services/agents/orchestrator/git-operations/pr/branch-pr-ops', () => ({
  FOREIGN_PR_ERROR_PREFIX: 'PR_IDENTITY_MISMATCH:',
}));

mock.module('../../services/workflow/auto-merge-notify', () => ({
  notify: () => Promise.resolve(),
}));

mock.module('../../services/github/pr-duplicate-guard', () => ({
  findOpenPrForTask: () => Promise.resolve(null),
  claimPrCreationLock: () => Promise.resolve(true),
  releasePrCreationLock: () => Promise.resolve(),
}));

// `git rev-list --count origin/<base>..HEAD` seen by countCommitsAhead. The
// default says the branch IS ahead so the existing tests keep exercising the
// gh path; the no-change test sets it to '0'.
let revListFixture = '1';
let createPullRequestCalls = 0;
let createCommitCalls = 0;
let removeWorktreeCalls = 0;
mock.module('../../services/github/git-exec', () => ({
  runGitCommand: () => Promise.resolve(revListFixture),
}));
let baseSyncFixture = {
  status: 'skipped',
  changedFiles: 0,
  conflicts: [] as string[],
  detail: 'no worktree',
};
mock.module('../../services/workflow/pre-pr-base-sync', () => ({
  syncBaseIntoBranch: () => Promise.resolve({ ...baseSyncFixture }),
}));

// Pre-gate harness sync (2026-09-13): recorded so a test can prove it runs
// BEFORE the verification gate and never decides the outcome by itself.
const callOrder: string[] = [];
const harnessSyncMock = mock(() => {
  callOrder.push('harness-sync');
  return Promise.resolve(null);
});
mock.module('../../services/workflow/harness-drift-sync', () => ({
  syncHarnessIfDrifted: harnessSyncMock,
}));

// Pre-save stage (2026-09-13): hard tamper/secret screen + advisory scope on
// the tree about to be recorded, then the LOCAL commit. The save delegates to
// the orchestrator mock above so createCommitCalls keeps counting.
let preSaveFixture = {
  ok: true,
  summary: 'tamper=n/a / secret=ok / scope=n/a',
  secrets: [] as string[],
};
// HEAD as seen by readHeadRevision: a queue lets a test make the second read
// (after the base sync) differ from the first (what the gate verified).
let headQueue: Array<string | null> = [];
const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);
mock.module('./workflow-auto-commit-presave', () => ({
  readHeadRevision: () =>
    Promise.resolve(headQueue.length > 1 ? headQueue.shift()! : (headQueue[0] ?? HEAD_A)),
  runPreSaveChecks: () => {
    callOrder.push('presave');
    return Promise.resolve({
      ...preSaveFixture,
      changedFiles: [],
      tamper: null,
      scope: null,
      unattributed: [],
      record: { ...preSaveFixture, unattributed: [] },
    });
  },
  saveTaskWorkLocally: async (p: {
    orchestrator: { createCommit: (cwd: string, msg: string, base: string) => Promise<unknown> };
    gitCwd: string;
    message: string;
    targetBranch: string;
  }) => {
    callOrder.push('commit');
    const c = (await p.orchestrator.createCommit(p.gitCwd, p.message, p.targetBranch)) as Record<
      string,
      unknown
    >;
    return { success: true, ...c };
  },
}));

const { performAutoCommitAndPR } = await import('./workflow-auto-commit');

describe('performAutoCommitAndPR — Auto-PR失敗時のログ出力', () => {
  test('既に実装済み(no-change)の場合はERRORではなくWARNで記録されること', async () => {
    errorLogCalls.length = 0;
    warnLogCalls.length = 0;
    filesChangedFixture = 0;
    prResultFixture = { success: false, error: 'no commits between develop and feature/t687' };

    const result = await performAutoCommitAndPR(687, '# 検証結果');

    expect(result.autoPRResult).toEqual({ success: false, error: prResultFixture.error });
    expect(errorLogCalls.find(([, msg]) => msg.includes('task 687'))).toBeUndefined();
    const warnLog = warnLogCalls.find(([, msg]) => msg.includes('task 687'));
    expect(warnLog).toBeDefined();
    const [loggedObj] = warnLog!;
    expect(loggedObj).not.toHaveProperty('error');
    expect(loggedObj.err).toBeInstanceOf(Error);
    expect((loggedObj.err as Error).message).toBe(prResultFixture.error);
  });

  test('真の失敗(認証エラー等)はERRORで err キー(Errorインスタンス)を渡して記録されること', async () => {
    errorLogCalls.length = 0;
    warnLogCalls.length = 0;
    filesChangedFixture = 1;
    prResultFixture = { success: false, error: 'gh: authentication failed' };

    const result = await performAutoCommitAndPR(687, '# 検証結果');

    expect(result.autoPRResult).toEqual({ success: false, error: prResultFixture.error });
    expect(warnLogCalls.find(([, msg]) => msg.includes('task 687'))).toBeUndefined();
    const errorLog = errorLogCalls.find(([, msg]) =>
      msg.includes('Auto-PR creation failed for task 687'),
    );
    expect(errorLog).toBeDefined();
    const [loggedObj] = errorLog!;
    expect(loggedObj).not.toHaveProperty('error');
    expect(loggedObj.err).toBeInstanceOf(Error);
    expect((loggedObj.err as Error).message).toBe(prResultFixture.error);
  });
});

describe('performAutoCommitAndPR — base より進んだコミットが無ければ gh を呼ばない', () => {
  test('rev-list が 0 なら createPullRequest を呼ばず、no-change として WARN で記録する', async () => {
    errorLogCalls.length = 0;
    warnLogCalls.length = 0;
    filesChangedFixture = 0;
    revListFixture = '0';
    createPullRequestCalls = 0;
    prResultFixture = { success: false, error: 'gh should not have been called' };
    const result = await performAutoCommitAndPR(739, '# 検証結果');
    expect(createPullRequestCalls).toBe(0);
    expect(result.autoPRResult?.success).toBe(false);
    expect(result.autoPRResult?.error).toContain('No commits between');
    expect(errorLogCalls.find(([, msg]) => msg.includes('task 739'))).toBeUndefined();
    expect(warnLogCalls.find(([, msg]) => msg.includes('task 739'))).toBeDefined();
    revListFixture = '1';
  });

  test('rev-list が 1 以上なら従来どおり createPullRequest を呼ぶ', async () => {
    filesChangedFixture = 1;
    revListFixture = '3';
    createPullRequestCalls = 0;
    prResultFixture = { success: false, error: 'gh: authentication failed' };
    await performAutoCommitAndPR(687, '# 検証結果');
    expect(createPullRequestCalls).toBe(1);
    revListFixture = '1';
  });
});

describe('publication preserves the verifier worktree until completion is settled', () => {
  test.each([
    { success: false, error: 'gh: authentication failed' },
    { success: false, error: 'no commits between develop and feature/t687' },
    { success: true, error: '', prNumber: 687 },
  ])('retains worktree and session after PR outcome %j', async (outcome) => {
    filesChangedFixture = outcome.success ? 1 : 0;
    revListFixture = '1';
    prResultFixture = outcome;
    removeWorktreeCalls = 0;
    mockPrisma.agentSession.update.mockClear();
    mockPrisma.task.findUnique.mockResolvedValueOnce({
      id: 687,
      title: 'verifier still running',
      theme: { workingDirectory: 'C:\\work\\project', defaultBranch: 'develop' },
      developerModeConfig: {
        agentSessions: [
          {
            id: 1,
            branchName: 'feature/t687',
            worktreePath: 'C:\\work\\project\\.worktrees\\task-687',
          },
        ],
      },
    });
    const result = await performAutoCommitAndPR(687, '# verification');
    expect(removeWorktreeCalls).toBe(0);
    expect(mockPrisma.agentSession.update).not.toHaveBeenCalled();
    expect(result.worktreeCleanupResult).toBeUndefined();
  });
});
describe('performAutoCommitAndPR — 停止後は後続の公開処理を一切行わない (task 895)', () => {
  const worktreePath = 'C:\\work\\project\\.worktrees\\task-895';
  const CANCELLED = 'タスクが停止されたため、公開処理を中断しました。';

  /** Re-arm the shared fixtures for one boundary case. */
  function arm(step: string | null): void {
    cancelAtStep = step;
    publicationAbortedCalls.length = 0;
    createCommitCalls = 0;
    createPullRequestCalls = 0;
    removeWorktreeCalls = 0;
    filesChangedFixture = 1;
    revListFixture = '1';
    removeWorktreeFixture = true;
    prResultFixture = { success: false, error: 'gh: authentication failed' };
    mockPrisma.agentSession.update.mockClear();
    mockPrisma.task.findUnique.mockResolvedValueOnce({
      id: 895,
      title: 'テストタスク',
      theme: { workingDirectory: 'C:\\work\\project', defaultBranch: 'develop' },
      developerModeConfig: {
        agentSessions: [{ id: 1, branchName: 'feature/t895', worktreePath }],
      },
    });
  }

  test('entry で停止済みなら commit も PR も worktree削除も行わない', async () => {
    arm('entry');
    const result = await performAutoCommitAndPR(895, '# 検証結果');
    expect(result.error).toBe(CANCELLED);
    expect(createCommitCalls).toBe(0);
    expect(createPullRequestCalls).toBe(0);
    expect(removeWorktreeCalls).toBe(0);
  });

  test('検証ゲート通過後に停止されたら push/PR 以降を行わない (ローカル保存は済んでいる)', async () => {
    arm('after_verification_gate');
    const result = await performAutoCommitAndPR(895, '# 検証結果');
    expect(result.error).toBe(CANCELLED);
    expect(createCommitCalls).toBe(1);
    expect(createPullRequestCalls).toBe(0);
    expect(removeWorktreeCalls).toBe(0);
  });

  test('commit 直前に停止されたら git へ書き込まない', async () => {
    arm('before_commit');
    const result = await performAutoCommitAndPR(895, '# 検証結果');
    expect(result.error).toBe(CANCELLED);
    expect(createCommitCalls).toBe(0);
    expect(createPullRequestCalls).toBe(0);
    expect(removeWorktreeCalls).toBe(0);
  });

  test('PR作成直前に停止されたら commit 済みでも PR を作らず worktree も残す', async () => {
    arm('before_pr');
    const result = await performAutoCommitAndPR(895, '# 検証結果');
    expect(result.error).toBe(CANCELLED);
    expect(createCommitCalls).toBe(1);
    expect(createPullRequestCalls).toBe(0);
    expect(removeWorktreeCalls).toBe(0);
    expect(mockPrisma.agentSession.update).not.toHaveBeenCalled();
  });

  test('worktree削除直前に停止されたら worktree を保全する', async () => {
    arm('before_worktree_cleanup');
    const result = await performAutoCommitAndPR(895, '# 検証結果');
    expect(result.error).toBe(CANCELLED);
    expect(removeWorktreeCalls).toBe(0);
    expect(mockPrisma.agentSession.update).not.toHaveBeenCalled();
  });

  test('停止が無ければ commit/PR へ進むが、完了前の worktree は削除しない', async () => {
    arm(null);
    prResultFixture = { success: false, error: 'gh: authentication failed' };
    const result = await performAutoCommitAndPR(895, '# 検証結果');
    expect(result.error).toBeUndefined();
    expect(createCommitCalls).toBe(1);
    expect(createPullRequestCalls).toBe(1);
    expect(removeWorktreeCalls).toBe(0);
    expect(publicationAbortedCalls).toEqual([
      'entry',
      'before_commit',
      'after_verification_gate',
      'before_pr',
      'before_worktree_cleanup',
    ]);
    cancelAtStep = null;
  });
});

test('unverifiable gate keeps the local commit and exposes the infrastructure outcome without publishing', async () => {
  cancelAtStep = null;
  const before = createCommitCalls;
  createPullRequestCalls = 0;
  verificationGateMock.mockResolvedValueOnce({
    ok: false,
    result: {
      ok: false,
      unverifiable: true,
      summary: 'runtime quarantined',
      checks: [],
      changedFiles: [],
    },
  });
  const outcome = await performAutoCommitAndPR(687, 'PASS');
  expect(outcome.verificationBlocked).toBe(true);
  expect(outcome.verificationUnverifiable).toBe(true);
  expect(outcome.error).toContain('runtime quarantined');
  expect(createCommitCalls).toBe(before + 1);
  expect(outcome.autoCommitResult?.hash).toBe('abc123');
  expect(createPullRequestCalls).toBe(0);
});

test('a hard pre-save failure (tamper/secret) records nothing and publishes nothing', async () => {
  cancelAtStep = null;
  callOrder.length = 0;
  const before = createCommitCalls;
  createPullRequestCalls = 0;
  preSaveFixture = {
    ok: false,
    summary: 'tamper=ok / secret=NG(1) / scope=n/a',
    secrets: ['.env'],
  };
  const outcome = await performAutoCommitAndPR(687, 'PASS');
  preSaveFixture = { ok: true, summary: 'tamper=n/a / secret=ok / scope=n/a', secrets: [] };
  expect(callOrder).toEqual(['presave']);
  expect(outcome.verificationBlocked).toBe(true);
  expect(outcome.verificationUnverifiable).toBe(false);
  expect(outcome.error).toContain('secret=NG(1)');
  expect(outcome.preSaveResult?.secrets).toEqual(['.env']);
  expect(createCommitCalls).toBe(before);
  expect(createPullRequestCalls).toBe(0);
});

describe('publish guard: the pushed revision is the verified revision', () => {
  test('a clean sync that moved HEAD re-runs the gate; PR follows only when it passes', async () => {
    cancelAtStep = null;
    filesChangedFixture = 1;
    revListFixture = '1';
    createPullRequestCalls = 0;
    prResultFixture = { success: true, error: '', prNumber: 701 };
    baseSyncFixture = { status: 'clean', changedFiles: 3, conflicts: [], detail: 'merged' };
    headQueue = [HEAD_A, HEAD_B, HEAD_B];
    verificationGateMock.mockClear();
    const out = await performAutoCommitAndPR(687, 'PASS');
    expect(verificationGateMock).toHaveBeenCalledTimes(2);
    expect(out.verifiedRevision).toBe(HEAD_B);
    expect(out.publishedRevision).toBe(HEAD_B);
    expect(createPullRequestCalls).toBe(1);
    expect(out.autoPRResult?.success).toBe(true);
    baseSyncFixture = { status: 'skipped', changedFiles: 0, conflicts: [], detail: 'no worktree' };
    headQueue = [];
  });

  test('re-verification failure after the sync keeps the commit and withholds the PR', async () => {
    cancelAtStep = null;
    filesChangedFixture = 1;
    createPullRequestCalls = 0;
    baseSyncFixture = { status: 'clean', changedFiles: 2, conflicts: [], detail: 'merged' };
    headQueue = [HEAD_A, HEAD_B, HEAD_B];
    verificationGateMock.mockClear();
    verificationGateMock.mockResolvedValueOnce({ ok: true, result: null });
    verificationGateMock.mockResolvedValueOnce({
      ok: false,
      result: { ok: false, summary: 'test=NG(1)', checks: [], changedFiles: [] },
    });
    const out = await performAutoCommitAndPR(687, 'PASS');
    expect(verificationGateMock).toHaveBeenCalledTimes(2);
    expect(out.verificationBlocked).toBe(true);
    expect(out.error).toContain('再検証に失敗');
    expect(out.autoCommitResult?.hash).toBe('abc123');
    expect(createPullRequestCalls).toBe(0);
    baseSyncFixture = { status: 'skipped', changedFiles: 0, conflicts: [], detail: 'no worktree' };
    headQueue = [];
  });

  test('HEAD that drifted without a recorded sync is never pushed', async () => {
    cancelAtStep = null;
    filesChangedFixture = 1;
    createPullRequestCalls = 0;
    headQueue = [HEAD_A, HEAD_B, HEAD_B];
    verificationGateMock.mockClear();
    const out = await performAutoCommitAndPR(687, 'PASS');
    // The guard treats a moved HEAD as new code: re-gate, then publish HEAD_B.
    expect(verificationGateMock).toHaveBeenCalledTimes(2);
    expect(out.publishedRevision).toBe(HEAD_B);
    headQueue = [HEAD_A, null, null];
    createPullRequestCalls = 0;
    const held = await performAutoCommitAndPR(687, 'PASS');
    expect(held.error).toContain('検証済みの版と HEAD が一致しない');
    expect(createPullRequestCalls).toBe(0);
    headQueue = [];
  });
});

test('order: pre-save → local commit → harness sync → gate; a held gate never publishes', async () => {
  cancelAtStep = null;
  callOrder.length = 0;
  harnessSyncMock.mockImplementationOnce(() => {
    callOrder.push('harness-sync');
    return Promise.resolve({
      reason: 'drift',
      sync: { status: 'conflict_unresolved', changedFiles: 0, conflicts: ['a.ts'], detail: 'x' },
      harnessPresent: false,
    });
  });
  verificationGateMock.mockImplementationOnce(() => {
    callOrder.push('gate');
    return Promise.resolve({
      ok: false,
      result: {
        ok: false,
        unverifiable: true,
        summary: 'runtime=UNVERIFIED',
        checks: [],
        changedFiles: [],
      },
    });
  });
  const before = createCommitCalls;
  createPullRequestCalls = 0;
  const outcome = await performAutoCommitAndPR(687, 'PASS');
  expect(callOrder).toEqual(['presave', 'commit', 'harness-sync', 'gate']);
  expect(outcome.harnessSyncResult?.sync.status).toBe('conflict_unresolved');
  expect(outcome.verificationBlocked).toBe(true);
  expect(outcome.verificationUnverifiable).toBe(true);
  expect(createCommitCalls).toBe(before + 1);
  expect(createPullRequestCalls).toBe(0);
});
