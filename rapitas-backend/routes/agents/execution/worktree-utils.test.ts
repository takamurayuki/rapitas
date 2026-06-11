/**
 * Tests for isIsolatedWorktree in worktree-utils.
 * This guard prevents destructive git reset/clean from running on the main
 * checkout — a revertChanges incident proved it must be tested explicitly.
 */

import { describe, expect, test } from 'bun:test';
import { isIsolatedWorktree } from './worktree-utils';

describe('isIsolatedWorktree', () => {
  test('returns true for a path under .worktrees/ (Unix style)', () => {
    expect(isIsolatedWorktree('/home/user/rapitas/.worktrees/task-42')).toBe(true);
  });

  test('returns true for a nested path under .worktrees/', () => {
    expect(isIsolatedWorktree('/home/user/rapitas/.worktrees/task-99/sub/dir')).toBe(true);
  });

  test('returns false for the main checkout (no .worktrees/ segment)', () => {
    expect(isIsolatedWorktree('/home/user/rapitas')).toBe(false);
  });

  test('returns false for process.cwd() style path without .worktrees/', () => {
    expect(isIsolatedWorktree('C:/Projects/rapitas')).toBe(false);
  });

  test('returns true for Windows backslash path under .worktrees/', () => {
    // Windows paths use backslashes; the function must normalize them.
    expect(isIsolatedWorktree('C:\\Projects\\rapitas\\.worktrees\\task-211-091be7d4')).toBe(true);
  });

  test('returns false for a path that merely contains "worktrees" without the dot prefix', () => {
    expect(isIsolatedWorktree('/home/user/worktrees/task-1')).toBe(false);
  });

  test('returns false for an empty string', () => {
    expect(isIsolatedWorktree('')).toBe(false);
  });
});
