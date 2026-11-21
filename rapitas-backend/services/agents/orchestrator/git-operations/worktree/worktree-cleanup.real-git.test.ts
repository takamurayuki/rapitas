/**
 * worktree-cleanup.real-git.test
 *
 * The `.worktrees/` state measured on 2026-11-03 (#1403), rebuilt in a real
 * temp repository and run through the real cleanupOrphanedWorktrees — keep
 * list, session reconcile, terminal sweep, orphan sweep, removeWorktree and
 * git itself. Only the database and the GitHub PR lookup are stubbed.
 *
 * - task-1305 (done) holds an uncommitted edit to a tracked file → kept.
 * - task-1291 (row deleted, branch has no open PR, clean) → reclaimed.
 * - a deleted task whose branch still has an OPEN PR → kept.
 * - a terminal task with only gitignored leftovers (.env, run-checked logs) → reclaimed.
 * - a live task, and a hand-made worktree with no task id (t944-…) → kept.
 */
import { afterEach, beforeEach, describe, expect, mock, setDefaultTimeout, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

mock.module('../../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

/** Rows that exist: id → status. */
let taskRows = new Map<number, string>();
/** Finished sessions that recorded a worktree path. */
let sessions: Array<{ id: number; worktreePath: string; status: string }> = [];
mock.module('../../../../../config/database', () => ({
  prisma: {
    task: {
      findMany: mock((args: { where: { id: { in: number[] }; status?: { notIn?: string[] } } }) => {
        const notIn = args.where.status?.notIn;
        return Promise.resolve(
          args.where.id.in
            .filter((id) => taskRows.has(id))
            .filter((id) => !notIn || !notIn.includes(taskRows.get(id)!))
            .map((id) => ({ id, status: taskRows.get(id)! })),
        );
      }),
    },
    agentSession: {
      findMany: mock(() => Promise.resolve(sessions)),
      updateMany: mock(() => Promise.resolve({ count: 0 })),
    },
  },
}));

/** branch → PR states. */
let prStates = new Map<string, string[]>();
mock.module('../../../../github/pr-head-lookup', () => ({
  listPullRequestsForHead: mock((_dir: string, branch: string) =>
    Promise.resolve(
      (prStates.get(branch) ?? []).map((state, i) => ({
        number: i + 1,
        state,
        headRefName: branch,
        headRefOid: '0'.repeat(40),
      })),
    ),
  ),
}));

const { cleanupOrphanedWorktrees } = await import('./worktree-cleanup');
const { resetRemovalBackoff } = await import('./worktree-removal-backoff');

// Each case spawns a few dozen git processes; on Windows that alone can pass
// bun's 5s default.
setDefaultTimeout(60_000);

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

let root: string;
let repo: string;

/** Add a worktree under `.worktrees/` on a new branch, with gitignored leftovers. */
function addWorktree(name: string, branch: string): string {
  const wt = join(repo, '.worktrees', name);
  git(repo, 'worktree', 'add', '-q', '-b', branch, wt);
  writeFileSync(join(wt, '.env'), 'SECRET=not-work\n');
  mkdirSync(join(wt, '.verification-logs'));
  writeFileSync(join(wt, '.verification-logs', '1_bun-test.log'), 'output\n');
  return wt;
}

beforeEach(() => {
  resetRemovalBackoff();
  root = realpathSync(mkdtempSync(join(tmpdir(), 'wt-cleanup-1403-')));
  repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'develop');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 't');
  writeFileSync(join(repo, '.gitignore'), '.env\n.verification-logs/\n.worktrees/\n');
  writeFileSync(join(repo, 'tracked.ts'), 'export const x = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  prStates = new Map();
  taskRows = new Map();
  sessions = [];
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('cleanupOrphanedWorktrees on the #1403 leftovers (real git)', () => {
  test('reclaims what is provably disposable and keeps everything else', async () => {
    const t1305 = addWorktree('task-1305-0522dfb6', 'feature/t1305-update-task');
    writeFileSync(join(t1305, 'tracked.ts'), 'export const x = 2; // unlanded fix\n');
    const t1306 = addWorktree('task-1306-aaaaaaaa', 'feature/t1306-update-task');
    const t1291 = addWorktree('task-1291-cadd90a4', 'feature/t1291-update-task');
    const t1292 = addWorktree('task-1292-bbbbbbbb', 'feature/t1292-update-task');
    const t1400 = addWorktree('task-1400-cccccccc', 'feature/t1400-update-task');
    const t944 = addWorktree('t944-qa-stop-deadlock', 'feature/workspace-tenancy-stage3');

    taskRows = new Map([
      [1305, 'done'],
      [1306, 'done'],
      [1400, 'in_progress'],
    ]);
    prStates = new Map([['feature/t1292-update-task', ['OPEN']]]);

    const cleaned = await cleanupOrphanedWorktrees(repo);

    expect(cleaned).toBe(2);
    expect(existsSync(t1306)).toBe(false);
    expect(existsSync(t1291)).toBe(false);
    // Uncommitted work survives, byte for byte.
    expect(existsSync(join(t1305, 'tracked.ts'))).toBe(true);
    expect(git(t1305, 'status', '--porcelain')).toContain('tracked.ts');
    for (const kept of [t1292, t1400, t944]) expect(existsSync(kept)).toBe(true);
    const listed = git(repo, 'worktree', 'list');
    expect(listed).not.toContain('task-1291-cadd90a4');
    expect(listed).toContain('task-1305-0522dfb6');
  });
});

// 2026-11-21: the scheduler runs with rapitas as `baseDir`, so the keep list
// covered only rapitas's own .worktrees. A finished verifier session of
// trendline task 1520 then got its worktree removed on the next cycle while
// the task was live and an implementer was working in it — three times in a
// row (task-1520-44b88654 → a11ed9e9 → 1b5598e6).
describe('a live task in another repository', () => {
  test('keeps its worktree although a finished session points at it', async () => {
    const other = join(root, 'other-project');
    mkdirSync(other);
    git(other, 'init', '-q', '-b', 'develop');
    git(other, 'config', 'user.email', 't@example.com');
    git(other, 'config', 'user.name', 't');
    writeFileSync(join(other, '.gitignore'), '.worktrees/\n');
    writeFileSync(join(other, 'tracked.ts'), 'export const y = 1;\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-q', '-m', 'base');
    const wt = join(other, '.worktrees', 'task-1520-1b5598e6');
    git(other, 'worktree', 'add', '-q', '-b', 'feature/t1520-verify-database', wt);

    taskRows = new Map([[1520, 'in-progress']]);
    sessions = [{ id: 1, worktreePath: wt, status: 'completed' }];

    // `repo` plays rapitas: the cleanup's baseDir is not the worktree's repo.
    await cleanupOrphanedWorktrees(repo);

    expect(existsSync(join(wt, 'tracked.ts'))).toBe(true);
    expect(git(other, 'worktree', 'list')).toContain('task-1520-1b5598e6');
  });

  test('still reclaims it once that task is done', async () => {
    const other = join(root, 'other-project');
    mkdirSync(other);
    git(other, 'init', '-q', '-b', 'develop');
    git(other, 'config', 'user.email', 't@example.com');
    git(other, 'config', 'user.name', 't');
    writeFileSync(join(other, '.gitignore'), '.worktrees/\n');
    writeFileSync(join(other, 'tracked.ts'), 'export const y = 1;\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-q', '-m', 'base');
    const wt = join(other, '.worktrees', 'task-1521-aaaaaaaa');
    git(other, 'worktree', 'add', '-q', '-b', 'feature/t1521-done', wt);

    taskRows = new Map([[1521, 'done']]);
    sessions = [{ id: 2, worktreePath: wt, status: 'completed' }];

    await cleanupOrphanedWorktrees(repo);

    expect(existsSync(wt)).toBe(false);
  });
});
