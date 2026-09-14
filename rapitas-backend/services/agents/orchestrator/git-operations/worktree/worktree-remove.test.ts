/**
 * WorktreeRemove — dirty-tree refusal regression (task 917, 受入基準6).
 *
 * Exercises removeWorktree() against a real git directory instead of mocking
 * git — the same contentIsSafe() gate every call site (worktree-cleanup.ts,
 * tasks.ts, stop-route.ts, reset-route.ts, completed-task-cleanup.ts) shares,
 * so a real-git regression here covers all of them.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { removeWorktree } from './worktree-remove';

let baseDir: string;
let worktreePath: string;
const prefix = join(tmpdir(), 'rapitas-worktree-remove-');
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: worktreePath, encoding: 'utf8' }).trim();
const write = (name: string, content: string) => writeFileSync(join(worktreePath, name), content);

beforeEach(() => {
  baseDir = mkdtempSync(prefix);
  // isPathSafeForWorktreeOperation requires the target under <baseDir>/.worktrees/.
  worktreePath = join(baseDir, '.worktrees', 'task-917-abc123');
  execFileSync('git', ['init', '--quiet', worktreePath]);
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Worktree remove test');
  write('tracked.txt', 'implementer work\n');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture');
});

afterEach(() => {
  const target = resolve(baseDir);
  if (!target.startsWith(resolve(prefix)) || !target.startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('Unsafe test fixture cleanup path');
  }
  rmSync(target, { recursive: true, force: true });
});

test('refuses removal when a tracked file has uncommitted modifications', async () => {
  write('tracked.txt', 'uncommitted edit\n');

  const removed = await removeWorktree(baseDir, worktreePath, false);

  expect(removed).toBe(false);
  expect(existsSync(worktreePath)).toBe(true);
  expect(readFileSync(join(worktreePath, 'tracked.txt'), 'utf8')).toBe('uncommitted edit\n');
});

test('refuses removal when only an untracked file is present (no tracked changes)', async () => {
  write('new-untracked.txt', 'implementer new file\n');

  const removed = await removeWorktree(baseDir, worktreePath, false);

  expect(removed).toBe(false);
  expect(existsSync(worktreePath)).toBe(true);
  expect(existsSync(join(worktreePath, 'new-untracked.txt'))).toBe(true);
});

test('refuses removal when both tracked and untracked changes are present', async () => {
  write('tracked.txt', 'uncommitted edit\n');
  write('new-untracked.txt', 'implementer new file\n');

  const removed = await removeWorktree(baseDir, worktreePath, false);

  expect(removed).toBe(false);
  expect(readFileSync(join(worktreePath, 'tracked.txt'), 'utf8')).toBe('uncommitted edit\n');
  expect(existsSync(join(worktreePath, 'new-untracked.txt'))).toBe(true);
});
