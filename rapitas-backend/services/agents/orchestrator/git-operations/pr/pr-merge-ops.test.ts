/**
 * pr-merge-ops — readAuthoritativeMergeState ユニットテスト (task 895)
 *
 * 「既にマージ済みか」を GitHub に直接確認する読み取り専用APIが、MERGED /
 * OPEN / gh実行失敗 / 壊れたJSON をそれぞれ正しく返すことを検証する。
 * マージ操作を行わないこと（gh の引数が pr view のみ）も確認する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

type ExecArgs = { file: string; args: string[] };
const execCalls: ExecArgs[] = [];
let execFixture: { stdout: string } | Error = { stdout: '' };
// Per-call script for the mergePullRequest cases below (null = use execFixture).
let execScript: ((file: string, args: string[]) => { stdout: string } | Error) | null = null;
mock.module('child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void,
  ) => {
    execCalls.push({ file, args });
    const fx = execScript ? execScript(file, args) : execFixture;
    if (fx instanceof Error) cb(fx);
    else cb(null, { stdout: fx.stdout, stderr: '' });
  },
}));

mock.module('../worktree/worktree-guard', () => ({
  isPrimaryWorkTree: () => Promise.resolve(false),
  findConflictingWorktreeForBranch: () => Promise.resolve(null),
  recoverFromUnresolvedMerge: () => Promise.resolve(),
}));
mock.module('../../../../github/gh-retry', () => ({
  isHeadBehindError: () => false,
  isAlreadyUpToDate: () => false,
}));
mock.module('./gh-cli-path', () => ({ ghPath: () => 'gh' }));

const { readAuthoritativeMergeState, mergePullRequest } = await import('./pr-merge-ops');

beforeEach(() => {
  execCalls.length = 0;
  execScript = null;
});

describe('mergePullRequest — gh exits non-zero AFTER the merge landed', () => {
  const merged = JSON.stringify({
    number: 776,
    state: 'MERGED',
    mergedAt: '2026-09-20T09:51:53Z',
    baseRefName: 'develop',
  });
  const localDeleteFailure = new Error(
    "Command failed: gh pr merge 776 --merge --delete-branch\nfailed to delete local branch bugfix/t1009-update-task: failed to run git: error: cannot delete branch 'bugfix/t1009-update-task' used by worktree at 'C:/Projects/rapitas/.worktrees/task-1009'",
  );

  test('local branch cleanup failure with the PR MERGED on GitHub is a successful merge', async () => {
    execScript = (file, args) => {
      if (file === 'gh' && args[1] === 'merge') return localDeleteFailure;
      if (file === 'gh' && args[1] === 'view' && args.includes('commits')) return { stdout: '2' };
      if (file === 'gh' && args[1] === 'view') return { stdout: merged };
      return { stdout: '' }; // git checkout / git pull follow-up
    };

    const result = await mergePullRequest('C:\\wt\\task-1009', 776, 5, 'develop');

    expect(result.success).toBe(true);
    expect(result.mergeStrategy).toBe('merge');
    // The authoritative read happened before the decision, not just the final confirmation.
    const views = execCalls.filter((c) => c.args[1] === 'view' && !c.args.includes('commits'));
    expect(views.length).toBeGreaterThanOrEqual(2);
  });

  test('a merge error while the PR is still OPEN stays a failure', async () => {
    const open = JSON.stringify({
      number: 776,
      state: 'OPEN',
      mergedAt: null,
      baseRefName: 'develop',
    });
    execScript = (file, args) => {
      if (file === 'gh' && args[1] === 'merge')
        return new Error('gh: Pull request is not mergeable');
      if (file === 'gh' && args[1] === 'view' && args.includes('commits')) return { stdout: '2' };
      if (file === 'gh' && args[1] === 'view') return { stdout: open };
      return { stdout: '' };
    };

    const result = await mergePullRequest('C:\\wt\\task-1009', 776, 5, 'develop');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not mergeable');
  });
});

describe('readAuthoritativeMergeState', () => {
  test('supervisor: explicit repository survives an unrelated fallback cwd', async () => {
    execFixture = { stdout: JSON.stringify({ number: 621, state: 'OPEN' }) };
    await readAuthoritativeMergeState('C:\\unrelated', 621, 'acme/repo');
    expect(execCalls[0]!.args.slice(-2)).toEqual(['--repo', 'acme/repo']);
  });
  test('MERGED の PR は state と mergedAt を返す', async () => {
    execFixture = {
      stdout: JSON.stringify({
        number: 621,
        state: 'MERGED',
        mergedAt: '2026-09-08T02:27:44Z',
        baseRefName: 'develop',
      }),
    };

    const result = await readAuthoritativeMergeState('C:\\repo', 621);

    expect(result).toEqual({
      number: 621,
      state: 'MERGED',
      mergedAt: '2026-09-08T02:27:44Z',
      baseRefName: 'develop',
    });
  });

  test('読み取り専用: gh pr view のみを実行し、merge 系サブコマンドを呼ばない', async () => {
    execFixture = { stdout: JSON.stringify({ number: 621, state: 'OPEN', mergedAt: null }) };

    await readAuthoritativeMergeState('C:\\repo', 621);

    expect(execCalls.length).toBe(1);
    expect(execCalls[0]!.args.slice(0, 2)).toEqual(['pr', 'view']);
    expect(execCalls[0]!.args).not.toContain('merge');
  });

  test('OPEN の PR は state=OPEN / mergedAt=null を返す', async () => {
    execFixture = {
      stdout: JSON.stringify({
        number: 621,
        state: 'OPEN',
        mergedAt: null,
        baseRefName: 'develop',
      }),
    };

    const result = await readAuthoritativeMergeState('C:\\repo', 621);

    expect(result?.state).toBe('OPEN');
    expect(result?.mergedAt).toBeNull();
  });

  test('gh 実行失敗時は null', async () => {
    execFixture = new Error('gh: not authenticated');
    expect(await readAuthoritativeMergeState('C:\\repo', 621)).toBeNull();
  });

  test('JSONが壊れている / 必須フィールド欠落なら null', async () => {
    execFixture = { stdout: 'not json' };
    expect(await readAuthoritativeMergeState('C:\\repo', 621)).toBeNull();
    execFixture = { stdout: JSON.stringify({ state: 'MERGED' }) };
    expect(await readAuthoritativeMergeState('C:\\repo', 621)).toBeNull();
  });
});
