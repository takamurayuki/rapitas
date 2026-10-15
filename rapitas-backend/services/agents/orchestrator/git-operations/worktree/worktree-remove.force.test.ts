/**
 * worktree-remove.force.test
 *
 * Real-git check that removeWorktree's forceRemove mode (used by disposable
 * comparison-cell worktrees) deletes a dirty worktree and its branch, while the
 * default mode still refuses to destroy uncommitted work.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { removeWorktree } from './worktree-remove';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

let root: string;
let repo: string;
let wt: string;
const BRANCH = 'shadow-cmp-test-branch';

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'wt-force-')));
  repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 't');
  writeFileSync(join(repo, 'tracked.txt'), 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  wt = join(repo, '.worktrees', 'wt-cell');
  git(repo, 'worktree', 'add', '-q', '-b', BRANCH, wt);
  // Agent behaviour: modify a tracked file and add an untracked one.
  writeFileSync(join(wt, 'tracked.txt'), 'changed\n');
  writeFileSync(join(wt, 'new.txt'), 'untracked\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('removeWorktree forceRemove', () => {
  test('既定では dirty な worktree の削除を拒否する（回帰）', async () => {
    const removed = await removeWorktree(repo, wt, true);
    expect(removed).toBe(false);
    expect(existsSync(wt)).toBe(true);
  });

  test('forceRemove=true は dirty でも worktree とブランチを残さない', async () => {
    const removed = await removeWorktree(repo, wt, true, undefined, true);
    expect(removed).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(git(repo, 'worktree', 'list')).not.toContain('wt-cell');
    expect(git(repo, 'branch', '--list', BRANCH)).toBe('');
  });

  test('forceRemove=true は commit 済みで未 push のブランチも削除する', async () => {
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', 'agent commit');
    writeFileSync(join(wt, 'late.txt'), 'dirty again\n');
    const removed = await removeWorktree(repo, wt, true, undefined, true);
    expect(removed).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(git(repo, 'branch', '--list', BRANCH)).toBe('');
  });
});
