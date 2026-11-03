/**
 * worktree-keep-list テスト
 *
 * 非終端タスクのworktreeが保護されること(blockedも保護)、終端タスクと
 * 存在しないタスクのworktreeは保護されないこと、所有者不明ディレクトリは
 * `.git` を持つ限り保護（`.git` の無い所有者不明ディレクトリは worktree ではないので
 * 保護しない — #1403: `.worktrees/.verification-logs` と空の `.worktrees/.worktrees`
 * がこの規則だけで永久に残っていた）、DB失敗時は全保護(fail-safe)、そして生存判定が
 * 呼び出し元のワークスペースに絞られないことを検証する。
 * Own file — mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

let dirNames: string[] = [];
let readdirShouldFail = false;
mock.module('fs/promises', () => ({
  readdir: mock(() => {
    if (readdirShouldFail) return Promise.reject(new Error('ENOENT'));
    return Promise.resolve(dirNames);
  }),
}));

let liveTaskIds: number[] = [];
let dbShouldFail = false;
const taskFindMany = mock((args: { where: { id: { in: number[] } } }) => {
  if (dbShouldFail) return Promise.reject(new Error('db down'));
  return Promise.resolve(
    liveTaskIds.filter((id) => args.where.id.in.includes(id)).map((id) => ({ id })),
  );
});
mock.module('../../config/database', () => ({ prisma: { task: { findMany: taskFindMany } } }));

// Directories (by basename) that hold a `.git` entry, i.e. are real worktrees.
let withGitEntry = new Set<string>();
let lstatError: NodeJS.ErrnoException | null = null;
const realFs = await import('node:fs');
mock.module('node:fs', () => ({
  ...realFs,
  lstatSync: (p: string) => {
    if (lstatError) throw lstatError;
    const parts = p.replace(/\\/g, '/').split('/');
    if (parts.at(-1) === '.git' && withGitEntry.has(parts.at(-2) ?? '')) return {};
    throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
  },
}));

const { computeWorktreeKeepPaths, parseTaskIdFromWorktreeName } =
  await import('./worktree-keep-list');

beforeEach(() => {
  dirNames = [];
  liveTaskIds = [];
  readdirShouldFail = false;
  dbShouldFail = false;
  withGitEntry = new Set();
  lstatError = null;
  taskFindMany.mockClear();
});

describe('parseTaskIdFromWorktreeName', () => {
  test('task-<id>-<hash> 形式からidを抽出する', () => {
    expect(parseTaskIdFromWorktreeName('task-494-c55f20f3')).toBe(494);
    expect(parseTaskIdFromWorktreeName('task-1-x')).toBe(1);
  });

  test('規約外の名前はnull', () => {
    expect(parseTaskIdFromWorktreeName('scratch')).toBeNull();
    expect(parseTaskIdFromWorktreeName('task-abc-x')).toBeNull();
  });
});

describe('computeWorktreeKeepPaths', () => {
  test('done/cancelledタスクは終端として扱い、生存クエリのnotInに含める', async () => {
    dirNames = ['task-100-bbbb'];

    await computeWorktreeKeepPaths('C:/repo');
    const where = taskFindMany.mock.calls[0][0].where as { status: { notIn: string[] } };
    expect(where.status.notIn).toContain('done');
    expect(where.status.notIn).toContain('cancelled');
  });

  test('非終端タスク(blocked含む)のworktreeは保護、終端/不存在は保護しない', async () => {
    dirNames = ['task-494-aaaa', 'task-100-bbbb', 'task-999-cccc'];
    liveTaskIds = [494]; // 100=completed想定(クエリが返さない), 999=不存在

    const keep = await computeWorktreeKeepPaths('C:/repo');
    expect(keep).toHaveLength(1);
    expect(keep[0]).toContain('task-494-aaaa');
  });

  test('所有者不明でも .git を持つ worktree は保護される', async () => {
    dirNames = ['task-494-aaaa', 'manual-experiment'];
    withGitEntry = new Set(['manual-experiment']);
    liveTaskIds = [];

    const keep = await computeWorktreeKeepPaths('C:/repo');
    expect(keep).toHaveLength(1);
    expect(keep[0]).toContain('manual-experiment');
  });

  // #1403: `t944-qa-stop-deadlock` (a hand-made worktree) must stay protected,
  // while `.verification-logs` (run-checked output) and an empty `.worktrees`
  // are not worktrees at all and were kept only by this rule.
  test('.git の無い所有者不明ディレクトリは保護しない(#1403)', async () => {
    dirNames = ['t944-qa-stop-deadlock', '.verification-logs', '.worktrees'];
    withGitEntry = new Set(['t944-qa-stop-deadlock']);

    const keep = await computeWorktreeKeepPaths('C:/repo');
    expect(keep).toHaveLength(1);
    expect(keep[0]).toContain('t944-qa-stop-deadlock');
  });

  test('.git の有無が判定できなければ保護する(fail-safe)', async () => {
    dirNames = ['.verification-logs'];
    lstatError = Object.assign(new Error('EPERM'), { code: 'EPERM' });

    const keep = await computeWorktreeKeepPaths('C:/repo');
    expect(keep).toHaveLength(1);
  });

  // A request-scoped caller (the POST cleanup routes run inside the signed-in
  // workspace) must not see another workspace's live task as "absent" — that
  // would drop its worktree from the keep list.
  test('生存判定はワークスペースに絞られない', async () => {
    const { runInWorkspace, currentWorkspaceId } = await import('../tenancy/workspace-context');
    let seen: number | null | undefined;
    taskFindMany.mockImplementationOnce(() => {
      seen = currentWorkspaceId();
      return Promise.resolve([]);
    });
    dirNames = ['task-1-a'];

    await runInWorkspace(7, () => computeWorktreeKeepPaths('C:/repo'));
    expect(seen).toBeNull();
  });

  test('DB失敗時は全ディレクトリを保護する(fail-safe)', async () => {
    dirNames = ['task-1-a', 'task-2-b'];
    dbShouldFail = true;

    const keep = await computeWorktreeKeepPaths('C:/repo');
    expect(keep).toHaveLength(2);
  });

  test('.worktrees が無ければ空(保護対象なし)', async () => {
    readdirShouldFail = true;
    expect(await computeWorktreeKeepPaths('C:/repo')).toEqual([]);
  });
});
