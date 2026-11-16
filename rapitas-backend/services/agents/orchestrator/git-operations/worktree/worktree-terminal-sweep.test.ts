/**
 * worktree-terminal-sweep テスト
 *
 * 終端タスクのclean worktreeはsession行なしでも削除、keep登録分は保護、
 * dirty拒否はバックオフ記録、非終端タスクは触らないことを検証する。
 *
 * #1403: DBから消えたタスクのworktree（task-1291-cadd90a4: GET /tasks/1291 が404）は
 * 「終端と確認できない」という理由だけで永久に残っていた。ブランチがOPENなPRの
 * 対象でないと確認できた場合に限り削除候補にする（dirty判定はremoveWorktreeが行う）。
 * PR情報が取れない・ブランチが分からない場合は残す。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

let dirNames: string[] = [];
mock.module('node:fs/promises', () => ({ readdir: mock(() => Promise.resolve(dirNames)) }));

/** Task rows that exist in the DB: id → status. Absent ids are deleted tasks. */
let taskRows = new Map<number, string>();
let seenWorkspace: Array<number | null> = [];
const { currentWorkspaceId, runInWorkspace } =
  await import('../../../../tenancy/workspace-context');
const taskFindMany = mock(
  (args: { where: { id: { in: number[] }; status?: { in: string[] } } }) => {
    seenWorkspace.push(currentWorkspaceId());
    const wanted = args.where.status?.in;
    return Promise.resolve(
      args.where.id.in
        .filter((id) => taskRows.has(id))
        .filter((id) => !wanted || wanted.includes(taskRows.get(id)!))
        .map((id) => ({ id, status: taskRows.get(id)! })),
    );
  },
);
mock.module('../../../../../config/database', () => ({
  prisma: { task: { findMany: taskFindMany } },
}));

let refuse = new Set<string>();
const removeWorktree = mock((_base: string, p: string) =>
  Promise.resolve(![...refuse].some((r) => p.includes(r))),
);
mock.module('./worktree-remove', () => ({ removeWorktree }));

/** dir name → checked-out branch (null = detached); absent = not registered. */
let registered = new Map<string, string | null>();
let listFails = false;
mock.module('./worktree-git-list', () => ({
  GIT_OP_TIMEOUT_MS: 60_000,
  pruneWorktrees: mock(() => Promise.resolve()),
  listRegisteredWorktrees: mock(async (baseDir: string) => {
    if (listFails) throw new Error('git worktree list timed out');
    const { normalizePath } = await import('../core/safety');
    return [...registered].map(([name, branch]) => {
      const path = `${baseDir}/.worktrees/${name}`;
      return { path, normalized: normalizePath(path), branch };
    });
  }),
}));

/** branch → PR states; absent branch = no PRs; `null` value = lookup failed. */
let prsByBranch = new Map<string, string[] | null>();
const listPullRequestsForHead = mock((_dir: string, branch: string) => {
  const states = prsByBranch.has(branch) ? prsByBranch.get(branch)! : [];
  if (states === null) return Promise.resolve(null);
  return Promise.resolve(
    states.map((state, i) => ({
      number: i + 1,
      state,
      headRefName: branch,
      headRefOid: 'f'.repeat(40),
    })),
  );
});
mock.module('../../../../github/pr-head-lookup', () => ({ listPullRequestsForHead }));

const { sweepTerminalTaskWorktrees } = await import('./worktree-terminal-sweep');
const { resetRemovalBackoff, parkedRemovalCount } = await import('./worktree-removal-backoff');
const { WORKTREE_DIR, normalizePath } = await import('../core/safety');

// An ABSOLUTE repo root for the host platform. A 'C:/repo' literal is absolute
// only on win32; elsewhere resolve() prefixes the cwd and every path assertion
// that embeds the literal silently stops matching.
const REPO = process.platform === 'win32' ? 'C:/repo' : '/repo';

beforeEach(() => {
  dirNames = [];
  taskRows = new Map();
  seenWorkspace = [];
  refuse = new Set();
  registered = new Map();
  listFails = false;
  prsByBranch = new Map();
  removeWorktree.mockClear();
  taskFindMany.mockClear();
  listPullRequestsForHead.mockClear();
  resetRemovalBackoff();
});

const removedPaths = () => removeWorktree.mock.calls.map((c) => c[1]);

describe('sweepTerminalTaskWorktrees', () => {
  test('AC1/AC2: 終端タスクのclean worktreeをsession行なしで削除する', async () => {
    dirNames = ['task-999-aaaa'];
    taskRows = new Map([[999, 'done']]);
    expect(await sweepTerminalTaskWorktrees(REPO, new Set())).toBe(1);
    expect(removeWorktree).toHaveBeenCalledTimes(1);
  });

  test('AC3: keep登録分は削除しない', async () => {
    dirNames = ['task-1-aaaa'];
    taskRows = new Map([[1, 'done']]);
    // normalizePath() runs resolve(), so a bare 'C:/repo/...' literal is only
    // already-normalized on Windows — on Linux resolve() treats it as RELATIVE
    // and prefixes the cwd, the keep entry stops matching, and the sweep deletes
    // a protected worktree. Build the key the same way the sweep does so this
    // asserts the documented contract instead of a win32 coincidence.
    const keep = new Set([normalizePath(`${REPO}/${WORKTREE_DIR}/task-1-aaaa`)]);
    expect(await sweepTerminalTaskWorktrees(REPO, keep)).toBe(0);
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  // The keep set protects against deletion, so a caller whose path is merely
  // unnormalized must not lose that protection — the failure mode is an
  // irreversible removal, not a missed optimisation.
  test('AC3: keep登録はパスが未正規化でも効く', async () => {
    dirNames = ['task-2-aaaa'];
    taskRows = new Map([[2, 'done']]);
    // A redundant '.' segment is un-normalized on every platform, unlike a
    // backslash (a separator only on win32).
    const keep = new Set([`${REPO}/${WORKTREE_DIR}/./task-2-aaaa`]);
    expect(await sweepTerminalTaskWorktrees(REPO, keep)).toBe(0);
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  test('非終端タスク(blocked含む)と規約外名は触らない', async () => {
    dirNames = ['task-5-aaaa', 'task-6-bbbb', 'scratch'];
    taskRows = new Map([
      [5, 'in_progress'],
      [6, 'blocked'],
    ]);
    registered = new Map([
      ['task-5-aaaa', 'feature/t5'],
      ['task-6-bbbb', 'feature/t6'],
    ]);
    expect(await sweepTerminalTaskWorktrees(REPO, new Set())).toBe(0);
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(listPullRequestsForHead).not.toHaveBeenCalled();
  });

  test('dirty拒否は件数に加えずバックオフへ記録する', async () => {
    dirNames = ['task-7-aaaa'];
    taskRows = new Map([[7, 'done']]);
    refuse = new Set(['task-7-']);
    expect(await sweepTerminalTaskWorktrees(REPO, new Set())).toBe(0);
    expect(parkedRemovalCount()).toBe(1);
    await sweepTerminalTaskWorktrees(REPO, new Set());
    expect(removeWorktree).toHaveBeenCalledTimes(1); // 2回目はクールダウンでスキップ
  });
});

describe('sweepTerminalTaskWorktrees — task missing from the DB (#1403)', () => {
  test('ブランチにOPENなPRが無ければ削除候補にする(task-1291 の再現)', async () => {
    dirNames = ['task-1291-cadd90a4'];
    registered = new Map([['task-1291-cadd90a4', 'feature/t1291-update-task']]);
    prsByBranch = new Map([['feature/t1291-update-task', ['MERGED']]]);
    expect(await sweepTerminalTaskWorktrees(REPO, new Set())).toBe(1);
    expect(removedPaths()[0]).toContain('task-1291-cadd90a4');
  });

  test('ブランチがOPENなPRの対象なら残す', async () => {
    dirNames = ['task-1291-cadd90a4'];
    registered = new Map([['task-1291-cadd90a4', 'feature/t1291-update-task']]);
    prsByBranch = new Map([['feature/t1291-update-task', ['CLOSED', 'OPEN']]]);
    expect(await sweepTerminalTaskWorktrees(REPO, new Set())).toBe(0);
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  test('PR情報が取れなければ残す(fail-safe)', async () => {
    dirNames = ['task-1291-cadd90a4'];
    registered = new Map([['task-1291-cadd90a4', 'feature/t1291-update-task']]);
    prsByBranch = new Map([['feature/t1291-update-task', null]]);
    expect(await sweepTerminalTaskWorktrees(REPO, new Set())).toBe(0);
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  test('ブランチが分からない(未登録/detached/一覧失敗)なら残す', async () => {
    dirNames = ['task-11-unreg', 'task-12-detached'];
    registered = new Map([['task-12-detached', null]]);
    expect(await sweepTerminalTaskWorktrees(REPO, new Set())).toBe(0);
    listFails = true;
    expect(await sweepTerminalTaskWorktrees(REPO, new Set())).toBe(0);
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(listPullRequestsForHead).not.toHaveBeenCalled();
  });

  test('未コミット作業があれば removeWorktree の拒否で残る', async () => {
    dirNames = ['task-1291-cadd90a4'];
    registered = new Map([['task-1291-cadd90a4', 'feature/t1291-update-task']]);
    refuse = new Set(['task-1291-']);
    expect(await sweepTerminalTaskWorktrees(REPO, new Set())).toBe(0);
    expect(removeWorktree).toHaveBeenCalledTimes(1);
    expect(parkedRemovalCount()).toBe(1);
  });

  // A request-scoped caller must not see another workspace's live task as
  // missing, or its worktree would become a deletion candidate.
  test('存在判定はワークスペースに絞られない', async () => {
    dirNames = ['task-1291-cadd90a4'];
    await runInWorkspace(3, () => sweepTerminalTaskWorktrees(REPO, new Set()));
    expect(seenWorkspace.length).toBeGreaterThan(0);
    expect(seenWorkspace.every((w) => w === null)).toBe(true);
  });
});
