/**
 * workflow-auto-commit 束縛テスト
 *
 * A review-hold override is bound to one worktree + verify.md + diff. The
 * commit side itself must enforce that binding: publish only from that
 * worktree, and stop when the diff changes before or during the commit
 * (G2 re-review item 1 — a check made only by the caller left a window).
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noop, logger: noop }));

let sessionWorktree: string | null = '/wt/B';
mock.module('../../config', () => ({
  prisma: {
    agentExecutionConfig: {
      findUnique: async () => ({
        autoCommit: true,
        autoCreatePR: true,
        autoMergePR: false,
        workingDirectory: '/theme',
        targetBranch: null,
      }),
    },
    task: {
      findUnique: async () => ({
        id: 5,
        title: 't',
        theme: { workingDirectory: '/theme', defaultBranch: 'develop' },
        developerModeConfig: {
          agentSessions: [{ id: 1, branchName: 'feature/t5', worktreePath: sessionWorktree }],
        },
      }),
    },
  },
  getProjectRoot: () => '/elsewhere',
}));
mock.module('./commit-cwd', () => ({
  resolveCommitCwd: async () => '/theme',
  findTaskWorktreeDir: async () => null,
}));
mock.module('../../services/workflow/publication-cancellation-guard', () => ({
  PUBLICATION_CANCELLED_ERROR: 'cancelled',
  publicationAborted: async () => false,
}));
mock.module('../../services/workflow/automation-policy', () => ({
  resolveAutomationPolicy: async () => ({
    autoCommit: true,
    autoCreatePR: true,
    autoMergePR: false,
  }),
  isStagedCompletionEnabled: () => true,
}));
mock.module('../../services/agents/verification/verification-gate', () => ({
  runVerificationGate: async () => ({ ok: true, result: null, verdict: 'pass' }),
}));

// The structured diff as git reports it; the REAL fingerprint is taken over it,
// so the untracked→committed transition of a new file is exercised for real.
// `duringCommit` lets a test change the tree while the commit is recorded.
type DiffFile = { filename: string; status: string; patch?: string };
const MODIFIED: DiffFile = { filename: 'a.ts', status: 'modified', patch: '-x\n+y\n' };
// getDiff synthesizes a new UNTRACKED file's patch (no index line, no final
// newline); once committed the same file comes from `git diff` itself.
const NEW_UNTRACKED: DiffFile = {
  filename: 'b.ts',
  status: 'added',
  patch:
    'diff --git a/b.ts b/b.ts\nnew file mode 100644\n--- /dev/null\n+++ b/b.ts\n@@ -0,0 +1,2 @@\n+one\n+two',
};
const NEW_COMMITTED: DiffFile = {
  filename: 'b.ts',
  status: 'added',
  patch:
    'diff --git a/b.ts b/b.ts\nnew file mode 100644\nindex 0000000..5f5fbe7\n--- /dev/null\n+++ b/b.ts\n@@ -0,0 +1,2 @@\n+one\n+two\n',
};
let currentFiles: DiffFile[] = [MODIFIED];
let currentSha: string | null = 'sha-B';
let duringCommit: (() => void) | null = null;
const fingerprintCwds: string[] = [];
mock.module('../../services/agents/orchestrator/git-operations/core/diff-structured', () => ({
  getDiff: async (cwd: string) => {
    fingerprintCwds.push(cwd);
    return currentFiles;
  },
  resolveBaseRef: async () => 'origin/develop',
}));
const nil = async () => null;
mock.module('../../services/task/task-resolver', () => ({
  resolvePreferredBaseBranch: async () => 'develop',
  resolveTaskWithTheme: nil,
  resolveTaskWithThemeAndCategory: nil,
  resolveTaskForExecution: nil,
  resolveTaskWorkingDirectory: nil,
  resolveTaskWorkflowState: nil,
  resolveTaskTitle: nil,
  resolveTaskThemeId: nil,
  resolveTaskForComplexityAnalysis: nil,
  resolveTaskSubtaskInfo: nil,
  resolveTaskForPlanApproval: nil,
  resolveTaskForAutoMerge: nil,
  taskRowConfirmedAbsent: async () => false,
  resolveTaskForLearning: nil,
}));
mock.module('../../services/workflow/verify-jury-completion', () => ({
  readVerifySha256: async () => currentSha,
}));

let commits = 0;
let prs = 0;
mock.module('../../services/agents/agent-orchestrator', () => ({
  AgentOrchestrator: {
    getInstance: () => ({
      createBranch: async () => {},
      createCommit: async () => {
        commits++;
        duringCommit?.();
        return { hash: 'h', branch: 'feature/t5', filesChanged: 1, alreadyCommitted: false };
      },
      createPullRequest: async () => {
        prs++;
        return { success: true, prUrl: 'u', prNumber: 9 };
      },
    }),
  },
}));
mock.module('./workflow-activity-logger', () => ({
  logAutoCommit: async () => {},
  logAutoPR: async () => {},
}));
mock.module('../../services/github/pr-link', () => ({ linkAutoCreatedPr: async () => {} }));
mock.module('../../services/agents/orchestrator/git-operations/pr/branch-pr-ops', () => ({
  FOREIGN_PR_ERROR_PREFIX: 'PR_IDENTITY_MISMATCH:',
}));
mock.module('../../services/workflow/auto-merge-notify', () => ({ notify: async () => {} }));
mock.module('../../services/github/pr-duplicate-guard', () => ({
  findOpenPrForTask: async () => null,
  claimPrCreationLock: async () => true,
  releasePrCreationLock: async () => {},
}));
mock.module('../../services/github/git-exec', () => ({ runGitCommand: async () => '1' }));
mock.module('../../services/workflow/harness-drift-sync', () => ({
  syncHarnessIfDrifted: async () => null,
}));
mock.module('./workflow-auto-commit-presave', () => ({
  listWorkingTreeChanges: async () => [],
  readHeadRevision: async () => 'a'.repeat(40),
  runPreSaveChecks: async () => ({
    ok: true,
    summary: 'ok',
    record: { ok: true, summary: 'ok', secrets: [] },
  }),
  saveTaskWorkLocally: async (p: {
    orchestrator: { createCommit: () => Promise<Record<string, unknown>> };
  }) => ({ success: true, ...(await p.orchestrator.createCommit()) }),
}));
mock.module('./workflow-auto-commit-publish-guard', () => ({
  syncAndReverifyBeforePublish: async () => ({
    ok: true,
    baseSync: { status: 'skipped', changedFiles: 0, conflicts: [], detail: '' },
    verifiedRevision: 'a'.repeat(40),
    headRevision: 'a'.repeat(40),
    reverified: false,
    verdict: 'pass',
  }),
}));
mock.module('../../services/agents/orchestrator/git-operations/pr/pr-draft-ops', () => ({
  readyPullRequest: async () => true,
}));
mock.module('./workflow-auto-commit-reuse-push', () => ({
  pushExistingPrBranch: async () => ({ success: true }),
}));

const { performAutoCommitAndPR } = await import('./workflow-auto-commit');
const { fingerprintDiff } =
  await import('../../services/agents/verification/review-diff-fingerprint');

const bindingFor = (files: DiffFile[]) => ({
  verifySha256: 'sha-B',
  diffFingerprint: fingerprintDiff(files)!,
  worktreePath: '/wt/B',
});
let BINDING = bindingFor([MODIFIED]);
const run = () => performAutoCommitAndPR(5, '# verify', { binding: BINDING });

beforeEach(() => {
  sessionWorktree = '/wt/B';
  currentFiles = [MODIFIED];
  BINDING = bindingFor([MODIFIED]);
  currentSha = 'sha-B';
  duringCommit = null;
  fingerprintCwds.length = 0;
  commits = 0;
  prs = 0;
});

describe('performAutoCommitAndPR — 上書きの束縛', () => {
  test('束縛どおりなら、その worktree の差分を確かめてコミットし PR を作る', async () => {
    const r = await run();
    expect(r.bindingMismatch).toBeUndefined();
    expect(r.autoPRResult?.success).toBe(true);
    expect(commits).toBe(1);
    expect(prs).toBe(1);
    expect(fingerprintCwds.length).toBeGreaterThan(0);
    expect(fingerprintCwds.every((c) => c === '/wt/B')).toBe(true);
  });

  test('公開に使う worktree が束縛と違えば、コミットも PR もしない', async () => {
    sessionWorktree = '/wt/A';
    const r = await run();
    expect(r.bindingMismatch).toContain('worktree');
    expect(r.error).toBeDefined();
    expect(commits).toBe(0);
    expect(prs).toBe(0);
  });

  test('worktree が無く theme ディレクトリへ落ちる場合も、コミットしない', async () => {
    sessionWorktree = null;
    const r = await run();
    expect(r.bindingMismatch).toBeDefined();
    expect(commits).toBe(0);
  });

  test('コミット直前に差分が変わっていれば、コミットしない', async () => {
    currentFiles = [{ ...MODIFIED, patch: '-x\n+z\n' }];
    const r = await run();
    expect(r.bindingMismatch).toContain('差分');
    expect(commits).toBe(0);
    expect(prs).toBe(0);
  });

  test('コミット直前に verify.md が変わっていれば、コミットしない', async () => {
    currentSha = 'sha-other';
    const r = await run();
    expect(r.bindingMismatch).toContain('verify.md');
    expect(commits).toBe(0);
  });

  test('コミットの最中に差分が変わったら、そのコミットを公開しない', async () => {
    duringCommit = () => (currentFiles = [MODIFIED, { ...MODIFIED, filename: 'c.ts' }]);
    const r = await run();
    expect(commits).toBe(1);
    expect(r.bindingMismatch).toContain('差分');
    expect(r.error).toBeDefined();
    expect(prs).toBe(0);
  });

  test('束縛を渡さない従来の呼び出しは、差分の照合をしない', async () => {
    currentFiles = [];
    const r = await performAutoCommitAndPR(5, '# verify');
    expect(r.bindingMismatch).toBeUndefined();
    expect(prs).toBe(1);
    expect(fingerprintCwds).toEqual([]);
  });

  test('未追跡の新規ファイルがコミットで追跡済みになっても、同じ差分として公開する', async () => {
    // The reviewed diff held b.ts untracked; the commit makes git report it.
    currentFiles = [MODIFIED, NEW_UNTRACKED];
    BINDING = bindingFor(currentFiles);
    duringCommit = () => (currentFiles = [MODIFIED, NEW_COMMITTED]);
    const r = await run();
    expect(r.bindingMismatch).toBeUndefined();
    expect(prs).toBe(1);
  });

  test('新規ファイルの中身がコミットの最中に変われば、公開しない', async () => {
    currentFiles = [MODIFIED, NEW_UNTRACKED];
    BINDING = bindingFor(currentFiles);
    duringCommit = () =>
      (currentFiles = [
        MODIFIED,
        { ...NEW_COMMITTED, patch: NEW_COMMITTED.patch!.replace('+two', '+TWO') },
      ]);
    const r = await run();
    expect(r.bindingMismatch).toContain('差分');
    expect(prs).toBe(0);
  });
});
