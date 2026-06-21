/**
 * worktree-guard.test
 *
 * Agent git mutations (commit / branch switch) must REFUSE the primary working
 * tree so they never clobber the developer's checkout (main-checkout clobber
 * incident).
 */
import { describe, test, expect } from 'bun:test';
import { execSync } from 'child_process';
import {
  isPrimaryWorkTree,
  ensureNotPrimaryWorkTree,
  isBackendPrimaryCheckout,
} from './worktree-guard';

const primary = async () => true;
const worktree = async () => false;

/** Returns the primary worktree path via `git worktree list`, or null on failure. */
function getPrimaryWorktreePath(): string | null {
  try {
    const out = execSync('git worktree list --porcelain', {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    // The first "worktree " line in the output is always the primary checkout.
    const line = out.split('\n').find((l: string) => l.startsWith('worktree '));
    return line ? line.slice('worktree '.length).trim() : null;
  } catch {
    return null;
  }
}

describe('isPrimaryWorkTree', () => {
  test('true for a non-git / non-existent path (fail-safe: errs toward blocking)', async () => {
    // NOTE: When detection fails, isPrimaryWorkTree returns true so the guard
    // always blocks rather than accidentally permitting a mutation on an unknown tree.
    await expect(isPrimaryWorkTree('/definitely/not/a/git/dir/zzz')).resolves.toBe(true);
  });

  test('false for a linked worktree (git-dir !== git-common-dir)', async () => {
    // NOTE: This assertion only runs when the test suite itself is executing from
    // inside a linked worktree (.worktrees/*) — the environment that makes the
    // assertion meaningful. When run from the primary checkout the test is a no-op.
    const cwd = process.cwd().replace(/\\/g, '/');
    if (!cwd.includes('/.worktrees/')) return;
    await expect(isPrimaryWorkTree(process.cwd())).resolves.toBe(false);
  });
});

describe('ensureNotPrimaryWorkTree', () => {
  test('throws on the primary working tree', async () => {
    await expect(ensureNotPrimaryWorkTree('/repo', 'commit', primary)).rejects.toThrow(
      /PRIMARY git working tree/,
    );
  });

  test('resolves for a linked worktree', async () => {
    await expect(
      ensureNotPrimaryWorkTree('/repo/.worktrees/task-1', 'commit', worktree),
    ).resolves.toBeUndefined();
  });

  test('includes the operation label in the error', async () => {
    await expect(
      ensureNotPrimaryWorkTree('/repo', 'switch to branch feature/x', primary),
    ).rejects.toThrow(/switch to branch feature\/x/);
  });
});

describe('isBackendPrimaryCheckout', () => {
  test('false for a non-existent / non-git directory (fail open, never refuses spuriously)', async () => {
    await expect(
      isBackendPrimaryCheckout('/definitely/not/a/git/repo/zzz-nonexistent'),
    ).resolves.toBe(false);
  });

  test("true for the backend's own primary checkout", async () => {
    // NOTE: Cannot use process.cwd() directly — when bun test runs inside a linked
    // worktree (.worktrees/*), process.cwd() is NOT the primary checkout. Instead,
    // locate the primary checkout dynamically via `git worktree list --porcelain`
    // so the test is correct in both primary-checkout and worktree environments.
    const primaryPath = getPrimaryWorktreePath();
    if (!primaryPath) return; // skip when git is unavailable
    await expect(isBackendPrimaryCheckout(primaryPath)).resolves.toBe(true);
  });
});
