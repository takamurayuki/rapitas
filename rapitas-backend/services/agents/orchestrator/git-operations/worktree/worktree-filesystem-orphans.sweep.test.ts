/**
 * worktree-filesystem-orphans.sweep.test
 *
 * The two unregistered directories found under `.worktrees/` on 2026-11-03
 * (#1403), reproduced on a real temp tree with the real keep list and sweep:
 *
 * - `.worktrees/.worktrees` — empty.
 * - `.worktrees/.verification-logs/<ts>_bun-test-….log` — run-checked.cjs
 *   output from a command run with `.worktrees/` as its cwd.
 *
 * Both were kept by computeWorktreeKeepPaths' "unparseable name → protect"
 * rule before the sweep ever looked at them, and the log file would still have
 * kept the second one as "work". Neither holds anything git or a person needs.
 * What must still survive: a hand-made worktree (has `.git`), an unexplained
 * file, and a live task's directory.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

mock.module('../../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

let liveTaskIds: number[] = [];
mock.module('../../../../../config/database', () => ({
  prisma: {
    task: {
      findMany: mock((args: { where: { id: { in: number[] } } }) =>
        Promise.resolve(
          liveTaskIds.filter((id) => args.where.id.in.includes(id)).map((id) => ({ id })),
        ),
      ),
    },
  },
}));

// None of the directories here is registered with git. Mirrors every export.
mock.module('./worktree-git-list', () => ({
  GIT_OP_TIMEOUT_MS: 60_000,
  listRegisteredWorktrees: mock(() => Promise.resolve([])),
  pruneWorktrees: mock(() => Promise.resolve()),
}));

const { sweepFilesystemOrphans, isRunCheckedLog } = await import('./worktree-filesystem-orphans');
const { computeWorktreeKeepPaths } = await import('../../../worktree-keep-list');
const { normalizePath } = await import('../core/safety');

let base: string;
let wt: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'wt-orphans-'));
  wt = join(base, '.worktrees');
  mkdirSync(wt);
  liveTaskIds = [];
});

afterEach(() => {
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/** Run the real keep list, then the real sweep, as cleanupOrphanedWorktrees does. */
async function sweep(): Promise<number> {
  const keep = new Set((await computeWorktreeKeepPaths(base)).map(normalizePath));
  return sweepFilesystemOrphans(base, keep);
}

describe('sweepFilesystemOrphans — #1403 leftovers', () => {
  test('reclaims the empty `.worktrees/.worktrees`', async () => {
    mkdirSync(join(wt, '.worktrees'));
    expect(await sweep()).toBe(1);
    expect(existsSync(join(wt, '.worktrees'))).toBe(false);
  });

  test('reclaims `.verification-logs` holding only run-checked logs', async () => {
    mkdirSync(join(wt, '.verification-logs'));
    writeFileSync(
      join(wt, '.verification-logs', '1791872376763_bun-test-isolate-services-workflow-que.log'),
      'output',
    );
    expect(await sweep()).toBe(1);
    expect(existsSync(join(wt, '.verification-logs'))).toBe(false);
  });

  test('keeps `.verification-logs` once it holds anything that is not a log', async () => {
    mkdirSync(join(wt, '.verification-logs'));
    writeFileSync(join(wt, '.verification-logs', 'a.log'), 'output');
    writeFileSync(join(wt, '.verification-logs', 'notes.txt'), 'someone wrote this');
    expect(await sweep()).toBe(0);
    expect(existsSync(join(wt, '.verification-logs', 'a.log'))).toBe(true);
  });

  test('keeps an unregistered hand-made worktree (has `.git`) and an unexplained file', async () => {
    mkdirSync(join(wt, 't944-qa-stop-deadlock'));
    writeFileSync(join(wt, 't944-qa-stop-deadlock', '.git'), 'gitdir: elsewhere');
    mkdirSync(join(wt, 'scratch'));
    writeFileSync(join(wt, 'scratch', 'draft.md'), 'work');
    expect(await sweep()).toBe(0);
    expect(existsSync(join(wt, 't944-qa-stop-deadlock', '.git'))).toBe(true);
    expect(existsSync(join(wt, 'scratch', 'draft.md'))).toBe(true);
  });

  test("keeps a live task's directory even when it is empty", async () => {
    mkdirSync(join(wt, 'task-42-abcd'));
    liveTaskIds = [42];
    expect(await sweep()).toBe(0);
    expect(existsSync(join(wt, 'task-42-abcd'))).toBe(true);
  });
});

describe('isRunCheckedLog', () => {
  test.each([
    ['.verification-logs/1_x.log', true],
    ['task-1-a/rapitas-backend/.verification-logs/2_y.log', true],
    ['.verification-logs/notes.txt', false],
    ['.verification-logs/sub/3.log', false],
    ['logs/4.log', false],
    ['x.log', false],
  ])('%s -> %p', (relative, expected) => {
    expect(isRunCheckedLog(relative)).toBe(expected);
  });
});
