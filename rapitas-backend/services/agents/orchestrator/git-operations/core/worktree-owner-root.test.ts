/**
 * worktree-owner-root.test
 *
 * A worktree path carries its own repository root: everything before the
 * `/.worktrees/` segment. Deriving it per path is what lets cleanup work for
 * generated projects, which live outside the rapitas checkout — and under
 * different parents from each other.
 *
 * Measured on 2026-10-10: cleanupOrphanedWorktrees was called with rapitas's
 * root as baseDir for EVERY session, so `isPathSafeForWorktreeOperation`
 * refused every generated-project path, the row's worktreePath was never
 * cleared, and the same 70 rows across 15 paths in 5 projects (trendline,
 * ime-live-converter, contextflow, temporaid — the oldest from task 498) were
 * retried on every cleanup cycle in every running backend. The retry cost is
 * what saturated the event loop until the self-heal restart fired.
 */
import { describe, expect, it } from 'bun:test';
import { resolveWorktreeOwnerRoot } from './worktree-owner-root';

describe('resolveWorktreeOwnerRoot', () => {
  it('derives the root for a rapitas worktree', () => {
    expect(resolveWorktreeOwnerRoot('C:\\Projects\\rapitas\\.worktrees\\task-1160-530ea3f7')).toBe(
      'C:/Projects/rapitas',
    );
  });

  it('derives the root for a generated project under a different parent', () => {
    // contextflow lives under C:\Users\ytaka\Projects, temporaid under
    // C:\Projects — so no single parent directory can be assumed.
    expect(
      resolveWorktreeOwnerRoot(
        'C:\\Users\\ytaka\\Projects\\contextflow\\.worktrees\\task-1152-f2fc9924',
      ),
    ).toBe('C:/Users/ytaka/Projects/contextflow');
    expect(
      resolveWorktreeOwnerRoot('C:\\Projects\\temporaid\\.worktrees\\task-1153-c3a5cb1f'),
    ).toBe('C:/Projects/temporaid');
  });

  it('accepts forward slashes and mixed separators', () => {
    expect(resolveWorktreeOwnerRoot('C:/Projects/rapitas/.worktrees/task-1161-9abf7a21')).toBe(
      'C:/Projects/rapitas',
    );
    expect(resolveWorktreeOwnerRoot('C:/Projects/rapitas\\.worktrees/task-1')).toBe(
      'C:/Projects/rapitas',
    );
  });

  it('handles a nested worktree directory deeper in the tree', () => {
    expect(resolveWorktreeOwnerRoot('D:/work/mono/packages/app/.worktrees/task-7')).toBe(
      'D:/work/mono/packages/app',
    );
  });

  it('returns null when the path has no .worktrees segment', () => {
    expect(resolveWorktreeOwnerRoot('C:/Projects/rapitas')).toBeNull();
    expect(resolveWorktreeOwnerRoot('C:/Projects/rapitas/rapitas-backend')).toBeNull();
  });

  it('returns null for a path that only ends at .worktrees', () => {
    // Nothing to remove, and treating the parent as the root would make the
    // caller try to delete the whole .worktrees directory.
    expect(resolveWorktreeOwnerRoot('C:/Projects/rapitas/.worktrees')).toBeNull();
    expect(resolveWorktreeOwnerRoot('C:/Projects/rapitas/.worktrees/')).toBeNull();
  });

  it('is not fooled by a similarly named directory', () => {
    expect(resolveWorktreeOwnerRoot('C:/Projects/rapitas/.worktrees-old/task-1')).toBeNull();
    expect(resolveWorktreeOwnerRoot('C:/Projects/rapitas/my.worktrees/task-1')).toBeNull();
  });

  it('returns null for empty or non-string-ish input', () => {
    expect(resolveWorktreeOwnerRoot('')).toBeNull();
    expect(resolveWorktreeOwnerRoot('   ')).toBeNull();
  });

  it('uses the FIRST .worktrees segment when a path nests two', () => {
    // A worktree created inside another worktree still belongs to the outer
    // repository as far as `git worktree remove` is concerned.
    expect(
      resolveWorktreeOwnerRoot('C:/Projects/rapitas/.worktrees/task-1/.worktrees/task-2'),
    ).toBe('C:/Projects/rapitas');
  });
});
