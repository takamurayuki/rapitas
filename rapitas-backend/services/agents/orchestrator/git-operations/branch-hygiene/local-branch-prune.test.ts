/**
 * local-branch-prune.test
 *
 * Real git, real `origin` (a bare repository in a temp dir). Only the GitHub
 * PR lookup is injected. The property under test is the one that matters when
 * it is wrong: a branch whose tip exists nowhere else must never be deleted,
 * whatever else is true of it.
 *
 * Background (#1403): GitHub's "delete branch on merge" was off, remote
 * branches piled up to 536 and local ones to 211, pruned by hand to 16 — and
 * nothing pruned LOCAL branches automatically afterwards.
 */
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneMergedLocalBranches } from './local-branch-prune';
import type { PullRequestHead } from '../../../../github/pr-head-lookup';

// Each case spawns a few dozen git processes; on Windows that alone can pass
// bun's 5s default.
setDefaultTimeout(60_000);

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

let root: string;
let origin: string;
let repo: string;
/** branch → PRs; absent = no PRs; null = lookup failed. */
let prs: Map<string, PullRequestHead[] | null>;
let lookups: string[];

const listPullRequestsForHead = (_dir: string, branch: string) => {
  lookups.push(branch);
  return Promise.resolve(prs.has(branch) ? prs.get(branch)! : []);
};

const localBranches = () =>
  git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/').split('\n').filter(Boolean);

/** Commit a file on a new branch cut from develop; optionally push it. */
function branchWithCommit(name: string, push: boolean): string {
  git(repo, 'switch', '-q', '-c', name, 'develop');
  writeFileSync(join(repo, `${name.replace(/\//g, '_')}.txt`), `${name}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', `work on ${name}`);
  if (push) git(repo, 'push', '-q', '-u', 'origin', name);
  git(repo, 'switch', '-q', 'develop');
  return git(repo, 'rev-parse', name);
}

/** Merge a branch into origin/develop (a real merge) and delete it remotely. */
function mergeOnOriginAndDelete(name: string): void {
  git(repo, 'merge', '-q', '--no-ff', '-m', `merge ${name}`, name);
  git(repo, 'push', '-q', 'origin', 'develop');
  git(repo, 'push', '-q', 'origin', '--delete', name);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'branch-prune-')));
  origin = join(root, 'origin.git');
  repo = join(root, 'repo');
  git(root, 'init', '-q', '--bare', '-b', 'develop', origin);
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'develop');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 't');
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', '-u', 'origin', 'develop');
  git(repo, 'branch', 'main');
  prs = new Map();
  lookups = [];
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('pruneMergedLocalBranches', () => {
  test('deletes a branch merged into origin/develop whose remote branch is gone', async () => {
    branchWithCommit('feature/merged', true);
    mergeOnOriginAndDelete('feature/merged');

    const result = await pruneMergedLocalBranches(repo, { listPullRequestsForHead });

    expect(result.deleted).toEqual(['feature/merged']);
    expect(localBranches()).not.toContain('feature/merged');
    // Ancestry alone proved it; GitHub was never asked.
    expect(lookups).toEqual([]);
  });

  test('deletes a squash-merged branch when a merged PR has exactly its tip', async () => {
    const tip = branchWithCommit('feature/squashed', true);
    git(repo, 'push', '-q', 'origin', '--delete', 'feature/squashed');
    prs.set('feature/squashed', [
      { number: 5, state: 'MERGED', headRefName: 'feature/squashed', headRefOid: tip },
    ]);

    const result = await pruneMergedLocalBranches(repo, { listPullRequestsForHead });

    expect(result.deleted).toEqual(['feature/squashed']);
  });

  test('keeps a branch with commits that were never pushed', async () => {
    branchWithCommit('feature/unpushed', false);

    const result = await pruneMergedLocalBranches(repo, { listPullRequestsForHead });

    expect(result.deleted).toEqual([]);
    expect(localBranches()).toContain('feature/unpushed');
  });

  test('keeps a branch committed past its merged PR head', async () => {
    const prTip = branchWithCommit('feature/moved-on', true);
    git(repo, 'push', '-q', 'origin', '--delete', 'feature/moved-on');
    git(repo, 'switch', '-q', 'feature/moved-on');
    writeFileSync(join(repo, 'later.txt'), 'local-only\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'after the PR');
    git(repo, 'switch', '-q', 'develop');
    prs.set('feature/moved-on', [
      { number: 6, state: 'CLOSED', headRefName: 'feature/moved-on', headRefOid: prTip },
    ]);

    const result = await pruneMergedLocalBranches(repo, { listPullRequestsForHead });

    expect(result.deleted).toEqual([]);
    expect(localBranches()).toContain('feature/moved-on');
  });

  test('keeps a branch whose only PR is still OPEN, or whose PR state is unknown', async () => {
    const openTip = branchWithCommit('feature/open-pr', true);
    git(repo, 'push', '-q', 'origin', '--delete', 'feature/open-pr');
    prs.set('feature/open-pr', [
      { number: 7, state: 'OPEN', headRefName: 'feature/open-pr', headRefOid: openTip },
    ]);
    branchWithCommit('feature/unknown', true);
    git(repo, 'push', '-q', 'origin', '--delete', 'feature/unknown');
    prs.set('feature/unknown', null);

    const result = await pruneMergedLocalBranches(repo, { listPullRequestsForHead });

    expect(result.deleted).toEqual([]);
    expect(localBranches()).toEqual(expect.arrayContaining(['feature/open-pr', 'feature/unknown']));
  });

  test('keeps a branch whose remote branch still exists', async () => {
    branchWithCommit('feature/still-remote', true);
    git(repo, 'merge', '-q', '--no-ff', '-m', 'merge', 'feature/still-remote');
    git(repo, 'push', '-q', 'origin', 'develop');

    const result = await pruneMergedLocalBranches(repo, { listPullRequestsForHead });

    expect(result.deleted).toEqual([]);
    expect(localBranches()).toContain('feature/still-remote');
  });

  // `git switch -c x origin/develop` leaves origin/develop as the upstream.
  // That records where the branch was cut from, not a remote copy of it.
  test('an upstream of origin/develop does not count as the remote branch', async () => {
    git(repo, 'branch', '--track', 'chore/cut-from-develop', 'origin/develop');
    git(repo, 'switch', '-q', '-c', 'feature/unpushed-tracking', '--track', 'origin/develop');
    writeFileSync(join(repo, 'wip.txt'), 'local-only\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'wip');
    git(repo, 'switch', '-q', 'develop');

    const result = await pruneMergedLocalBranches(repo, { listPullRequestsForHead });

    expect(result.deleted).toEqual(['chore/cut-from-develop']);
    expect(localBranches()).toContain('feature/unpushed-tracking');
  });

  test('keeps a merged branch that is checked out in a worktree', async () => {
    branchWithCommit('feature/checked-out', true);
    mergeOnOriginAndDelete('feature/checked-out');
    git(repo, 'worktree', 'add', '-q', join(root, 'wt'), 'feature/checked-out');

    const result = await pruneMergedLocalBranches(repo, { listPullRequestsForHead });

    expect(result.deleted).toEqual([]);
    expect(localBranches()).toContain('feature/checked-out');
  });

  test('never deletes main or develop', async () => {
    // `main` has no remote branch and is an ancestor of origin/develop — every
    // other condition holds, so only the name protects it.
    const result = await pruneMergedLocalBranches(repo, { listPullRequestsForHead });

    expect(result.deleted).toEqual([]);
    expect(localBranches()).toEqual(expect.arrayContaining(['main', 'develop']));
  });

  test('deletes nothing when the fetch fails (remote state unknown)', async () => {
    branchWithCommit('feature/merged', true);
    mergeOnOriginAndDelete('feature/merged');
    git(repo, 'remote', 'set-url', 'origin', join(root, 'does-not-exist.git'));

    const result = await pruneMergedLocalBranches(repo, { listPullRequestsForHead });

    expect(result.deleted).toEqual([]);
    expect(result.skipped).toBe('fetch-failed');
    expect(localBranches()).toContain('feature/merged');
  });
});
