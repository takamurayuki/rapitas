/**
 * worktree-sweep.test
 *
 * Against real git: a worktree is removed only when it sits in a managed
 * place, is not locked or owned by a task session, has been idle, has no
 * uncommitted work, and its commits are preserved on the remote. Links
 * inside it (node_modules junctions into the main checkout) are unlinked,
 * never followed — the target must survive.
 */
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sweepIdleWorktrees } from './worktree-sweep';
import type { PullRequestHead } from '../../../../github/pr-head-lookup';

setDefaultTimeout(120_000);

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

let root: string;
let origin: string;
let repo: string;
let outsideTarget: string;
let ratchetDir: string;
let prs: Map<string, PullRequestHead[]>;
const HOUR = 60 * 60 * 1000;
/** Two hours from now: every fresh worktree has been idle for longer than HOUR. */
const LATER = () => Date.now() + 2 * HOUR;

const lookupPrs = (_dir: string, branch: string) => Promise.resolve(prs.get(branch) ?? []);

/** A worktree on a new branch from develop with one commit. */
function worktreeWithCommit(rel: string, branch: string): string {
  const dir = join(repo, rel);
  git(repo, 'worktree', 'add', '-q', '-b', branch, dir, 'develop');
  writeFileSync(join(dir, `${branch.replace(/\//g, '_')}.txt`), `${branch}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `work on ${branch}`);
  return dir;
}

/** Make a branch's commit part of origin/develop (merged on top of the current develop). */
function mergeIntoDevelop(branch: string): void {
  git(repo, 'fetch', '-q', 'origin');
  git(repo, 'switch', '-q', '--detach', 'origin/develop');
  git(repo, 'merge', '-q', '--no-edit', '--no-ff', branch);
  git(repo, 'push', '-q', 'origin', 'HEAD:develop');
  git(repo, 'switch', '-q', 'develop');
  git(repo, 'fetch', '-q', 'origin');
}

const registered = () =>
  git(repo, 'worktree', 'list', '--porcelain')
    .split(/\r?\n/)
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length).replace(/\\/g, '/'));
const isRegistered = (dir: string) => registered().includes(dir.replace(/\\/g, '/'));

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'wt-sweep-')));
  origin = join(root, 'origin.git');
  repo = join(root, 'repo');
  git(root, 'init', '-q', '--bare', '-b', 'develop', origin);
  git(root, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'switch', '-q', '-c', 'develop');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n.worktrees/\n.claude/\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'push', '-q', '-u', 'origin', 'develop');
  git(repo, 'push', '-q', 'origin', 'develop:main');
  git(repo, 'fetch', '-q', 'origin');
  outsideTarget = join(root, 'shared-node-modules');
  mkdirSync(outsideTarget);
  writeFileSync(join(outsideTarget, 'keep.txt'), 'must survive\n');
  ratchetDir = '';
  prs = new Map();
});

afterEach(() => {
  if (ratchetDir && existsSync(ratchetDir)) rmSync(ratchetDir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

describe('sweepIdleWorktrees', () => {
  test('removes an idle, clean worktree whose work is on develop, unlinking its links first', async () => {
    const dir = worktreeWithCommit('.worktrees/merged', 'feature/merged');
    symlinkSync(outsideTarget, join(dir, 'node_modules'), 'junction');
    mergeIntoDevelop('feature/merged');

    const result = await sweepIdleWorktrees(repo, { lookupPrs, now: LATER(), idleMs: HOUR });

    expect(result.removed).toEqual([dir.replace(/\\/g, '/')]);
    expect(isRegistered(dir)).toBe(false);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(outsideTarget, 'keep.txt'))).toBe(true);
  });

  test('keeps a worktree with uncommitted work', async () => {
    const dir = worktreeWithCommit('.worktrees/dirty', 'feature/dirty');
    mergeIntoDevelop('feature/dirty');
    writeFileSync(join(dir, 'unsaved.txt'), 'not committed\n');

    const result = await sweepIdleWorktrees(repo, { lookupPrs, now: LATER(), idleMs: HOUR });

    expect(result.removed).toEqual([]);
    expect(result.kept).toContainEqual({ path: dir.replace(/\\/g, '/'), reason: 'dirty' });
  });

  test('keeps a worktree whose commits exist nowhere else', async () => {
    const dir = worktreeWithCommit('.claude/worktrees/agent-x', 'feature/local-only');

    const result = await sweepIdleWorktrees(repo, { lookupPrs, now: LATER(), idleMs: HOUR });

    expect(isRegistered(dir)).toBe(true);
    expect(result.kept).toContainEqual({ path: dir.replace(/\\/g, '/'), reason: 'unpreserved' });
  });

  test('removes a worktree whose branch was squash-merged (merged PR head)', async () => {
    const dir = worktreeWithCommit('.claude/worktrees/agent-y', 'feature/squashed');
    prs.set('feature/squashed', [
      { number: 1, state: 'MERGED', headRefOid: git(dir, 'rev-parse', 'HEAD') } as PullRequestHead,
    ]);

    const result = await sweepIdleWorktrees(repo, { lookupPrs, now: LATER(), idleMs: HOUR });

    expect(result.removed).toEqual([dir.replace(/\\/g, '/')]);
  });

  test('keeps locked, task-owned, recently used and out-of-place worktrees', async () => {
    const locked = worktreeWithCommit('.worktrees/locked', 'feature/locked');
    git(repo, 'worktree', 'lock', locked);
    const task = worktreeWithCommit('.worktrees/task-12-abcd', 'feature/t12');
    const outside = worktreeWithCommit('elsewhere', 'feature/elsewhere');
    for (const b of ['feature/locked', 'feature/t12', 'feature/elsewhere']) mergeIntoDevelop(b);

    const later = await sweepIdleWorktrees(repo, { lookupPrs, now: LATER(), idleMs: HOUR });
    expect(later.removed).toEqual([]);
    const reasons = Object.fromEntries(later.kept.map((k) => [k.path, k.reason]));
    expect(reasons[locked.replace(/\\/g, '/')]).toBe('locked');
    expect(reasons[task.replace(/\\/g, '/')]).toBe('task-owned');
    expect(reasons[outside.replace(/\\/g, '/')]).toBe('outside-roots');

    git(repo, 'worktree', 'unlock', locked);
    const recent = await sweepIdleWorktrees(repo, { lookupPrs, now: Date.now(), idleMs: HOUR });
    expect(recent.kept).toContainEqual({ path: locked.replace(/\\/g, '/'), reason: 'recent' });
    expect(isRegistered(locked)).toBe(true);
  });

  test('removes a leftover ratchet worktree in the temp directory', async () => {
    ratchetDir = join(tmpdir(), `rapitas-ratchet-sweeptest-${process.pid}-${Date.now()}`);
    git(repo, 'worktree', 'add', '-q', '--detach', ratchetDir, 'origin/develop');

    const result = await sweepIdleWorktrees(repo, { lookupPrs, now: LATER(), idleMs: HOUR });

    expect(result.removed).toContain(ratchetDir.replace(/\\/g, '/'));
    expect(isRegistered(ratchetDir)).toBe(false);
  });
});
