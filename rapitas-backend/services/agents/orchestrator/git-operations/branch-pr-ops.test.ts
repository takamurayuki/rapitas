/**
 * branch-pr-ops テスト
 *
 * createPullRequest の push 堅牢化を検証: origin のブランチが分岐している
 * (過去実行の `feature/implement-task` 等と衝突) 場合に、force-push せず
 * コミット一意のブランチへ push し直して PR 作成まで到達すること。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Scripted exec: maps a matched command substring → stdout, or throws when the
// value is an Error. Records every issued command for assertions.
let calls: string[] = [];
let script: Array<{ match: RegExp; result: string | Error }> = [];
// Controls the return value of the mocked findConflictingWorktreeForBranch.
let conflictingWorktreePath: string | null = null;
// Tracks runGhCommandWithBody calls (used for pr create assertions after tempfile removal).
let ghClientCalls: string[][] = [];
let ghClientResult: string | Error = '';

function runScripted(cmd: string): { stdout: string; stderr: string } {
  calls.push(cmd);
  for (const s of script) {
    if (s.match.test(cmd)) {
      if (s.result instanceof Error) throw s.result;
      return { stdout: s.result, stderr: '' };
    }
  }
  return { stdout: '', stderr: '' };
}

mock.module('child_process', () => ({
  // promisify(exec) calls exec(cmd, options, callback); resolve {stdout,stderr}.
  exec: (cmd: string, _opts: unknown, cb?: (e: Error | null, r?: unknown) => void) => {
    const callback = (typeof _opts === 'function' ? _opts : cb) as (
      e: Error | null,
      r?: unknown,
    ) => void;
    try {
      callback(null, runScripted(cmd));
    } catch (err) {
      callback(err as Error);
    }
  },
}));
mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));
// NOTE: worktree-guard is mocked entirely to prevent calls to execGitReadonly / child_process
// (real git). Guard behaviour is tested separately in worktree-guard.test.ts.
// findConflictingWorktreeForBranch reads conflictingWorktreePath so each test can control it.
mock.module('./worktree-guard', () => ({
  isPrimaryWorkTree: async () => false,
  ensureNotPrimaryWorkTree: async () => {},
  findConflictingWorktreeForBranch: async () => conflictingWorktreePath,
}));
// NOTE: gh-client is mocked to intercept runGhCommandWithBody (pr create) which uses
// execFile internally — outside the child_process.exec mock above.
mock.module('../../../github/gh-client', () => ({
  runGhCommandWithBody: async (args: string[], _body?: string, _cwd?: string) => {
    ghClientCalls.push(args);
    if (ghClientResult instanceof Error) throw ghClientResult;
    return ghClientResult;
  },
}));

const { createPullRequest, createBranch, mergePullRequest } = await import('./branch-pr-ops');

const rejected = () =>
  new Error(
    'Command failed: git push -u origin feature/implement-task\n ! [rejected] feature/implement-task -> feature/implement-task (non-fast-forward)',
  );

beforeEach(() => {
  calls = [];
  script = [];
  ghClientCalls = [];
  ghClientResult = '';
  conflictingWorktreePath = null;
});

describe('createPullRequest — push 分岐耐性', () => {
  test('origin が分岐していたらコミット一意ブランチへ push し直して PR 作成すること', async () => {
    ghClientResult = 'https://github.com/x/y/pull/42';
    script = [
      { match: /git branch --list develop/, result: 'develop\n' },
      { match: /git branch --show-current/, result: 'feature/implement-task\n' },
      { match: /git push -u origin feature\/implement-task$/, result: rejected() },
      { match: /git rev-parse --short HEAD/, result: 'abc1234\n' },
      { match: /git branch -M feature\/implement-task-abc1234/, result: '' },
      { match: /git push -u origin feature\/implement-task-abc1234$/, result: '' },
      { match: /pr list --head/, result: '' },
    ];

    const res = await createPullRequest('/repo', 'タイトル', '本文');

    expect(res.success).toBe(true);
    expect(res.prNumber).toBe(42);
    // 一意ブランチへリネームして push したこと（force-push していないこと）
    expect(calls.some((c) => /git branch -M feature\/implement-task-abc1234/.test(c))).toBe(true);
    expect(calls.some((c) => /git push -u origin feature\/implement-task-abc1234$/.test(c))).toBe(
      true,
    );
    expect(calls.some((c) => /--force/.test(c))).toBe(false);
    // PR は一意ブランチ head で探索されること
    expect(calls.some((c) => /pr list --head feature\/implement-task-abc1234/.test(c))).toBe(true);
  });

  test('push が成功すれば元のブランチのまま PR 作成すること', async () => {
    ghClientResult = 'https://github.com/x/y/pull/7';
    script = [
      { match: /git branch --list develop/, result: 'develop\n' },
      { match: /git branch --show-current/, result: 'feature/add-foo\n' },
      { match: /git push -u origin feature\/add-foo$/, result: '' },
      { match: /pr list --head/, result: '' },
    ];

    const res = await createPullRequest('/repo', 't', 'b');

    expect(res.success).toBe(true);
    expect(res.prNumber).toBe(7);
    expect(calls.some((c) => /git branch -M/.test(c))).toBe(false); // リネームしない
  });

  test('既存PRを再利用する際、ベースが target と違えば retarget すること (#172 回帰)', async () => {
    script = [
      { match: /git branch --list develop/, result: 'develop\n' },
      { match: /git branch --show-current/, result: 'chore/update-refactor\n' },
      { match: /git push -u origin chore\/update-refactor$/, result: '' },
      // 既存PR #172 は base=main で開かれている
      {
        match: /pr list --head chore\/update-refactor/,
        result: JSON.stringify({ number: 172, url: 'https://x/pull/172', baseRefName: 'main' }),
      },
      { match: /pr edit 172 --base develop/, result: '' },
    ];

    const res = await createPullRequest('/repo', 't', 'b');

    expect(res.success).toBe(true);
    expect(res.prNumber).toBe(172);
    // main -> develop へ retarget したこと
    expect(calls.some((c) => /pr edit 172 --base develop/.test(c))).toBe(true);
    // 再利用なので runGhCommandWithBody (pr create) は呼ばれないこと
    expect(ghClientCalls.length).toBe(0);
  });

  test('既存PRのベースが既に target と同じなら retarget しないこと', async () => {
    script = [
      { match: /git branch --list develop/, result: 'develop\n' },
      { match: /git branch --show-current/, result: 'feature/x-y\n' },
      { match: /git push -u origin feature\/x-y$/, result: '' },
      {
        match: /pr list --head feature\/x-y/,
        result: JSON.stringify({ number: 9, url: 'https://x/pull/9', baseRefName: 'develop' }),
      },
    ];

    const res = await createPullRequest('/repo', 't', 'b');

    expect(res.success).toBe(true);
    expect(res.prNumber).toBe(9);
    expect(calls.some((c) => /pr edit/.test(c))).toBe(false);
  });

  test('既存PRのnumberが0の場合は再利用せずpr createすること（0のfalsy挙動を固定）', async () => {
    // NOTE: `if (pr.number && pr.url)` は 0 が JavaScript で falsy になるため
    //       再利用パスに入らず gh pr create へフォールスルーする現挙動を固定する。
    //       GitHub PR #0 は実在しないため実害ゼロだが、将来同様の truthy チェックが
    //       増えた際の回帰検知点として意図的にテストする。
    ghClientResult = 'https://github.com/x/y/pull/99';
    script = [
      { match: /git branch --list develop/, result: 'develop\n' },
      { match: /git branch --show-current/, result: 'feature/pr-zero\n' },
      { match: /git push -u origin feature\/pr-zero$/, result: '' },
      // pr.number = 0 → if (0 && url) = false → 再利用をスキップして pr create へ
      {
        match: /pr list --head feature\/pr-zero/,
        result: JSON.stringify({ number: 0, url: 'https://x/pull/0', baseRefName: 'develop' }),
      },
    ];

    const res = await createPullRequest('/repo', 't', 'b');

    expect(res.success).toBe(true);
    expect(res.prNumber).toBe(99);
    // 0 は falsy のため再利用をスキップし、runGhCommandWithBody (pr create) が呼ばれること
    expect(ghClientCalls.some((args) => args.includes('create'))).toBe(true);
  });

  test('分岐以外の push 失敗 (認証等) は PR 失敗として返すこと', async () => {
    script = [
      { match: /git branch --list develop/, result: 'develop\n' },
      { match: /git branch --show-current/, result: 'feature/add-foo\n' },
      {
        match: /git push -u origin feature\/add-foo$/,
        result: new Error('fatal: Authentication failed'),
      },
    ];

    const res = await createPullRequest('/repo', 't', 'b');

    expect(res.success).toBe(false);
    expect(res.error).toContain('Authentication failed');
    expect(calls.some((c) => /git branch -M/.test(c))).toBe(false);
  });
});

describe('createBranch — worktree使用中チェック', () => {
  // NOTE: findConflictingWorktreeForBranch is fully mocked via worktree-guard mock.
  // Each test controls the return value through conflictingWorktreePath.

  test('別worktreeで使用中のブランチはcheckoutせずfalseを返すこと', async () => {
    conflictingWorktreePath = '/other-wt';
    script = [
      { match: /git branch --list chore\/update-refactor$/, result: 'chore/update-refactor\n' },
    ];

    const result = await createBranch('/working-dir', 'chore/update-refactor');

    expect(result).toBe(false);
    // checkout を試みないこと
    expect(calls.some((c) => /git checkout chore\/update-refactor$/.test(c))).toBe(false);
  });

  test('自分自身が同ブランチ上にある場合はcheckoutを続行してtrueを返すこと', async () => {
    // conflictingWorktreePath = null (デフォルト) → 競合なし → checkout 続行
    script = [
      { match: /git branch --list feature\/mine$/, result: 'feature/mine\n' },
      { match: /git checkout feature\/mine$/, result: '' },
    ];

    const result = await createBranch('/working-dir', 'feature/mine');

    expect(result).toBe(true);
    // 自分自身が使用中でも checkout を実行すること
    expect(calls.some((c) => /git checkout feature\/mine$/.test(c))).toBe(true);
  });

  test('どのworktreeも対象ブランチを使用していなければcheckoutを実行してtrueを返すこと', async () => {
    // conflictingWorktreePath = null (デフォルト) → 競合なし
    script = [
      { match: /git branch --list feature\/other$/, result: 'feature/other\n' },
      { match: /git checkout feature\/other$/, result: '' },
    ];

    const result = await createBranch('/working-dir', 'feature/other');

    expect(result).toBe(true);
    expect(calls.some((c) => /git checkout feature\/other$/.test(c))).toBe(true);
  });

  test('findConflictingWorktreeForBranch がnullを返す場合（list失敗fail-safe含む）checkoutを試みること', async () => {
    // conflictingWorktreePath = null はworktree list失敗時のfail-safe戻り値と同等
    script = [
      { match: /git branch --list feature\/list-fail$/, result: 'feature/list-fail\n' },
      { match: /git checkout feature\/list-fail$/, result: '' },
    ];

    const result = await createBranch('/working-dir', 'feature/list-fail');

    expect(result).toBe(true);
    // null 返却後も checkout を実行していること
    expect(calls.some((c) => /git checkout feature\/list-fail$/.test(c))).toBe(true);
  });

  test('新規ブランチ作成（-b）は worktree チェックなしで実行されること（回帰確認）', async () => {
    script = [
      { match: /git branch --list feature\/new-branch$/, result: '' }, // 存在しない
      { match: /git checkout -b feature\/new-branch$/, result: '' },
    ];

    const result = await createBranch('/working-dir', 'feature/new-branch');

    expect(result).toBe(true);
    expect(calls.some((c) => /git checkout -b feature\/new-branch$/.test(c))).toBe(true);
    // 新規ブランチは使用中チェック不要なので worktree prune/list を child_process 経由では呼ばないこと
    expect(calls.some((c) => /worktree/.test(c))).toBe(false);
  });
});

describe('mergePullRequest — worktree使用中チェック', () => {
  test('baseBranchが別worktreeで使用中の場合syncをスキップしてsuccess:trueを返すこと', async () => {
    conflictingWorktreePath = '/other-wt';
    script = [
      { match: /pr view \d+ --json commits/, result: '3\n' },
      { match: /pr merge \d+ --merge --delete-branch/, result: '' },
    ];

    const result = await mergePullRequest('/working-dir', 1, 5, 'develop');

    expect(result.success).toBe(true);
    expect(result.mergeStrategy).toBe('merge');
    // checkout は実行されないこと
    expect(calls.some((c) => /git checkout develop$/.test(c))).toBe(false);
    expect(calls.some((c) => /git pull$/.test(c))).toBe(false);
  });

  test('baseBranchが未使用の場合はcheckout+pullを実行してsuccess:trueを返すこと', async () => {
    // conflictingWorktreePath = null (デフォルト) → 競合なし
    script = [
      { match: /pr view \d+ --json commits/, result: '3\n' },
      { match: /pr merge \d+ --merge --delete-branch/, result: '' },
      { match: /git checkout develop$/, result: '' },
      { match: /git pull$/, result: '' },
    ];

    const result = await mergePullRequest('/working-dir', 1, 5, 'develop');

    expect(result.success).toBe(true);
    expect(calls.some((c) => /git checkout develop$/.test(c))).toBe(true);
    expect(calls.some((c) => /git pull$/.test(c))).toBe(true);
  });
});
