/**
 * worktree-guard.test
 *
 * Agent git mutations (commit / branch switch) must REFUSE the primary working
 * tree so they never clobber the developer's checkout (main-checkout clobber
 * incident).
 */
import { describe, test, expect } from 'bun:test';
import { ensureNotPrimaryWorkTree } from './worktree-guard';

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
