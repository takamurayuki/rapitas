/**
 * worktree-usable.test
 *
 * A recorded worktreePath may only be reused when it still exists on disk;
 * a phantom path (removed by cleanup/stop/merge) must trigger recreation, not a
 * crash. These pin that decision (task 233 regression).
 */
import { describe, test, expect } from 'bun:test';
import { canReuseWorktree, decideWorktree } from './worktree-usable';

const exists = () => true;
const missing = () => false;

describe('canReuseWorktree', () => {
  test('false for null / undefined / empty', () => {
    expect(canReuseWorktree(null, exists)).toBe(false);
    expect(canReuseWorktree(undefined, exists)).toBe(false);
    expect(canReuseWorktree('', exists)).toBe(false);
  });

  test('false when the path no longer exists on disk', () => {
    expect(canReuseWorktree('/gone/task-233', missing)).toBe(false);
  });

  test('true when the path exists on disk', () => {
    expect(canReuseWorktree('/live/task-1', exists)).toBe(true);
  });
});

describe('decideWorktree', () => {
  test('reuse when the recorded worktree still exists', () => {
    expect(decideWorktree('/live/task-1', 'feature/x', exists)).toBe('reuse');
  });

  test('recreate when the worktree is a phantom but a branch is known', () => {
    expect(decideWorktree('/gone/task-233', 'feature/x', missing)).toBe('recreate');
  });

  test('recreate when no path was recorded but a branch is known', () => {
    expect(decideWorktree(null, 'feature/x', missing)).toBe('recreate');
  });

  test('fallback when the worktree is missing and no branch is known', () => {
    expect(decideWorktree('/gone/task-233', null, missing)).toBe('fallback');
    expect(decideWorktree(null, null, missing)).toBe('fallback');
  });
});
