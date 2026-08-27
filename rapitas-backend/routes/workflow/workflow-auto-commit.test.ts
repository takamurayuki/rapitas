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

mock.module('../../services/workflow/automation-policy', () => ({
  resolveAutomationPolicy: () =>
    Promise.resolve({ autoCommit: true, autoCreatePR: true, autoMergePR: false }),
}));

mock.module('../../services/agents/verification/verification-gate', () => ({
  runVerificationGate: () => Promise.resolve({ ok: true }),
}));

// One mutable fixture per test drives createPullRequest's outcome and the
// commit's filesChanged count (both feed isNoChangeCompletion's classifier).
let prResultFixture: { success: false; error: string } = {
  success: false,
  error: 'no commits between develop and feature/t687',
};
let filesChangedFixture = 0;
mock.module('../../services/agents/agent-orchestrator', () => ({
  AgentOrchestrator: {
    getInstance: () => ({
      createBranch: () => Promise.resolve(),
      createCommit: () =>
        Promise.resolve({
          hash: 'abc123',
          branch: 'feature/t687',
          filesChanged: filesChangedFixture,
          additions: 0,
          deletions: 0,
          alreadyCommitted: false,
        }),
      createPullRequest: () => Promise.resolve(prResultFixture),
      removeWorktree: () => Promise.resolve(),
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

mock.module('../../services/workflow/pre-pr-base-sync', () => ({
  syncBaseIntoBranch: () =>
    Promise.resolve({ status: 'skipped', changedFiles: 0, conflicts: [], detail: 'no worktree' }),
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
