/**
 * safety.test
 *
 * Unit tests for the pure-function path safety utilities in safety.ts.
 * These guards are the last line of defense before destructive filesystem or git
 * operations — every branch must be covered so regressions are caught immediately.
 */
import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'path';
import { normalizePath, isPathSafeForWorktreeOperation } from './safety';

// Deterministic absolute base so normalizePath(resolve()) comparisons are stable.
const BASE = resolve(process.cwd(), '__safety-test-base__');
const WT_SAFE = join(BASE, '.worktrees', 'task-1');

describe('normalizePath', () => {
  test('replaces backslashes with forward slashes', () => {
    // NOTE: .replace(/\\/g, '/') always runs regardless of platform, so output
    // never contains backslashes even on Windows.
    const result = normalizePath('some\\path\\with\\backslashes');
    expect(result).not.toContain('\\');
  });

  test('makes relative paths absolute', () => {
    const result = normalizePath('./relative/path');
    // Absolute on all platforms: Unix starts with /, Windows starts with C:/ etc.
    expect(result).toMatch(/^(?:[a-zA-Z]:|\/)/);
  });
});

describe('isPathSafeForWorktreeOperation', () => {
  test('false when worktreePath is the main repository root itself', () => {
    // NOTE: Deleting baseDir would destroy .git/ — the primary safety constraint.
    expect(isPathSafeForWorktreeOperation(BASE, BASE)).toBe(false);
  });

  test('true for a canonical worktree path inside .worktrees/', () => {
    expect(isPathSafeForWorktreeOperation(WT_SAFE, BASE)).toBe(true);
  });

  test('false for a path with ".." traversal (even one that normalizes to inside .worktrees/)', () => {
    // NOTE: ".." in the raw string is rejected as defense-in-depth even if
    // normalizePath() would resolve it to a safe destination.
    // Use string concatenation to preserve ".." literally (path.join resolves it eagerly).
    const worktreeBase = join(BASE, '.worktrees').replace(/\\/g, '/');
    const traversal = `${worktreeBase}/x/../x`;
    expect(isPathSafeForWorktreeOperation(traversal, BASE)).toBe(false);
  });

  test('false for a sibling directory outside .worktrees/', () => {
    const sibling = join(BASE, 'not-a-worktree', 'task-1');
    expect(isPathSafeForWorktreeOperation(sibling, BASE)).toBe(false);
  });

  test('true for a path with mixed forward/backslash separators', () => {
    // NOTE: normalizePath() handles mixed separators via path.normalize + replace.
    // Force a mixed path by converting all slashes then re-adding one forward slash.
    const worktreePart = join(BASE, '.worktrees').replace(/\\/g, '/');
    const mixed = `${worktreePart}\\task-1`;
    expect(isPathSafeForWorktreeOperation(mixed, BASE)).toBe(true);
  });

  test('false for a path using .worktrees prefix spoofing (.worktrees-evil)', () => {
    // NOTE: startsWith(normalizedWorktreeDir + '/') guards against this —
    // ".worktrees-evil" does not start with ".worktrees/".
    const evil = join(BASE, '.worktrees-evil', 'task-1');
    expect(isPathSafeForWorktreeOperation(evil, BASE)).toBe(false);
  });
});
