/**
 * worktree-guard.test
 *
 * Agent git mutations (commit / branch switch) must REFUSE the primary working
 * tree so they never clobber the developer's checkout (main-checkout clobber
 * incident).
 */
import { describe, test, expect } from 'bun:test';
import { ensureNotPrimaryWorkTree, isBackendPrimaryCheckout } from './worktree-guard';

const primary = async () => true;
const worktree = async () => false;

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

  test("true for the backend's own primary checkout (process.cwd())", async () => {
    // The test suite runs from the backend's PRIMARY checkout, so its own cwd is
    // the self-development tree the guard must refuse mutating roles in.
    await expect(isBackendPrimaryCheckout(process.cwd())).resolves.toBe(true);
  });
});
