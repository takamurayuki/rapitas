/**
 * workflow-auto-commit 束縛テスト（実 git）
 *
 * The post-commit binding check must identify the committed content byte for
 * byte (and the file mode), not a normalized patch text. These run the real
 * getDiff, the real fingerprint and real `git add -A` / `git commit` in a
 * throwaway repository, and change the tree while the commit is recorded
 * (G2 re-review 2, item 1: a `++` line, a dropped final newline, and a
 * tracked new binary all slipped through the patch-based identity).
 */
import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noop, logger: noop }));

let repo = '';
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
        theme: { workingDirectory: '/theme', defaultBranch: 'main' },
        developerModeConfig: {
          agentSessions: [{ id: 1, branchName: 'feature/t5', worktreePath: repo }],
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
// branch-name-generator (via the real getDiff) imports ai-client, which needs the
// real config this file replaces; only its ref validator is exercised here.
mock.module('../../utils/ai-client', () => ({ sendAIMessage: async () => ({}) }));
const nil = async () => null;
mock.module('../../services/task/task-resolver', () => ({
  resolvePreferredBaseBranch: async () => 'main',
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
  readVerifySha256: async () => 'sha-B',
}));

const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd: repo,
    encoding: 'utf8',
  });

let duringCommit: (() => void) | null = null;
let afterCommit: (() => void) | null = null;
let prs = 0;
mock.module('../../services/agents/agent-orchestrator', () => ({
  AgentOrchestrator: {
    getInstance: () => ({
      createBranch: async () => {},
      // The real staging + commit, with an optional change while it is recorded.
      createCommit: async () => {
        duringCommit?.();
        git('add', '-A');
        git('commit', '-q', '--no-verify', '-m', 'save');
        afterCommit?.();
        return {
          hash: git('rev-parse', 'HEAD').trim(),
          branch: 'feature/t5',
          filesChanged: 1,
          alreadyCommitted: false,
        };
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
const { currentDiffFingerprint } =
  await import('../../services/agents/verification/review-diff-fingerprint');

const put = (name: string, content: string | Uint8Array) =>
  writeFileSync(join(repo, name), content);

/** Bind to the tree as it is now (what the human looked at), then publish. */
async function overrideAndPublish() {
  const diffFingerprint = await currentDiffFingerprint(5, repo);
  expect(diffFingerprint).toBeTruthy();
  return performAutoCommitAndPR(5, '# verify', {
    binding: { verifySha256: 'sha-B', diffFingerprint: diffFingerprint!, worktreePath: repo },
  });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'rapitas-binding-'));
  git('init', '-q', '-b', 'main');
  put('a.txt', 'base\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'feature/t5');
  put('a.txt', 'changed\n');
  duringCommit = null;
  afterCommit = null;
  prs = 0;
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('コミット後の照合は内容のバイト列とモードで行う（実 git）', () => {
  test('未追跡の新規ファイルがコミットで追跡済みになるだけなら、公開する', async () => {
    put('n.txt', 'one\ntwo');
    const r = await overrideAndPublish();
    expect(r.bindingMismatch).toBeUndefined();
    expect(prs).toBe(1);
  });

  test('レビュー再現：新規ファイルの `++` で始まる行がコミット中に変われば、公開しない', async () => {
    put('n.txt', '++a\n');
    duringCommit = () => put('n.txt', '++b\n');
    const r = await overrideAndPublish();
    expect(r.bindingMismatch).toContain('差分');
    expect(prs).toBe(0);
  });

  test('レビュー再現：新規ファイルの末尾改行がコミット中に消えれば、公開しない', async () => {
    put('n.txt', 'x\n');
    duringCommit = () => put('n.txt', 'x');
    const r = await overrideAndPublish();
    expect(r.bindingMismatch).toContain('差分');
    expect(prs).toBe(0);
  });

  test('レビュー再現：追跡済みの新規バイナリの中身がコミット中に変われば、公開しない', async () => {
    put('img.bin', new Uint8Array([0, 1, 2, 3, 0, 255]));
    git('add', 'img.bin');
    git('commit', '-q', '-m', 'add binary');
    duringCommit = () => put('img.bin', new Uint8Array([0, 1, 2, 4, 0, 255]));
    const r = await overrideAndPublish();
    expect(r.bindingMismatch).toContain('差分');
    expect(prs).toBe(0);
  });

  test('追跡済みの新規バイナリが変わらなければ、公開する', async () => {
    put('img.bin', new Uint8Array([0, 1, 2, 3, 0, 255]));
    git('add', 'img.bin');
    git('commit', '-q', '-m', 'add binary');
    const r = await overrideAndPublish();
    expect(r.bindingMismatch).toBeUndefined();
    expect(prs).toBe(1);
  });

  test('ファイルモードがコミット中に変われば、公開しない', async () => {
    put('n.sh', 'echo\n');
    duringCommit = () => chmodSync(join(repo, 'n.sh'), 0o755);
    const r = await overrideAndPublish();
    expect(r.bindingMismatch).toContain('差分');
    expect(prs).toBe(0);
  });

  test('コミットで消されるトップレベルの .wf- 一時ファイルは、照合に含めない', async () => {
    put('n.txt', 'one\n');
    put('.wf-tmp.md', 'scratch');
    // commitChanges/createCommit delete top-level `.wf-*` before `git add -A`.
    duringCommit = () => rmSync(join(repo, '.wf-tmp.md'));
    const r = await overrideAndPublish();
    expect(r.bindingMismatch).toBeUndefined();
    expect(prs).toBe(1);
  });

  test('コミットに入った変更が作業ツリーで元に戻されても、コミットされた中身で判定する', async () => {
    put('n.txt', 'one\n');
    duringCommit = () => put('n.txt', 'two\n');
    afterCommit = () => put('n.txt', 'one\n');
    const r = await overrideAndPublish();
    expect(r.bindingMismatch).toContain('差分');
    expect(prs).toBe(0);
  });
});
