/**
 * worktree-branch-delete.test
 *
 * Real git. A squash-merged task branch keeps its own commits on no remote,
 * so the removal kept it and warned on every auto-merged task (trial #1499,
 * PR #1569, 2026-11-16). Its change on the base is what makes it safe.
 */
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const warns: string[] = [];
mock.module('../../../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    debug: () => {},
    error: () => {},
    warn: (m: unknown) => warns.push(String(m)),
  }),
}));

const { isBranchSquashMerged, deleteWorktreeBranch } = await import('./worktree-branch-delete');

let repo = '';
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
const put = (name: string, content: string) => writeFileSync(join(repo, name), content);
const branches = () => git('branch', '--format=%(refname:short)').split('\n');

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'rapitas-branch-delete-'));
  git('init', '-q', '-b', 'develop');
  put('a.txt', 'base\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'feature/t1');
  put('a.txt', 'one\n');
  git('commit', '-q', '-am', 'step 1');
  put('b.txt', 'two\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'step 2');
  git('checkout', '-q', 'develop');
  warns.length = 0;
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

/** Squash the branch into develop and publish develop as origin/develop. */
function squashIntoRemoteDevelop() {
  git('merge', '-q', '--squash', 'feature/t1');
  git('commit', '-q', '-m', 'squash (#1)');
  put('c.txt', 'later\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'a later change on develop');
  git('update-ref', 'refs/remotes/origin/develop', 'develop');
}

test('a branch squash-merged into the remote base is deleted, without a warning', async () => {
  squashIntoRemoteDevelop();
  expect(await isBranchSquashMerged(repo, 'feature/t1')).toBe(true);
  await deleteWorktreeBranch(repo, 'feature/t1', false);
  expect(branches()).not.toContain('feature/t1');
  expect(warns).toEqual([]);
});

test('a branch with work beyond the squash is kept, with the recovery hint', async () => {
  squashIntoRemoteDevelop();
  git('checkout', '-q', 'feature/t1');
  put('d.txt', 'not merged\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'step 3');
  git('checkout', '-q', 'develop');
  expect(await isBranchSquashMerged(repo, 'feature/t1')).toBe(false);
  await deleteWorktreeBranch(repo, 'feature/t1', false);
  expect(branches()).toContain('feature/t1');
  expect(warns[0]).toContain('KEEPING unmerged branch feature/t1');
});

test('an unmerged, unpushed branch with no remote base is kept', async () => {
  expect(await isBranchSquashMerged(repo, 'feature/t1')).toBe(false);
  await deleteWorktreeBranch(repo, 'feature/t1', false);
  expect(branches()).toContain('feature/t1');
});
