/**
 * resolve-worktree-base-dir tests
 *
 * Verifies that a worktree of a foreign repository resolves to its own parent repo
 * instead of the caller's fallback baseDir. Uses a temp dir to stay OS-independent.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveWorktreeBaseDir } from './resolve-worktree-base-dir';
import { isPathSafeForWorktreeOperation } from './safety';

let root: string;
let rapitas: string;
let foreign: string;
let foreignWt: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'rwbd-'));
  rapitas = join(root, 'rapitas');
  foreign = join(root, 'contextflow');
  foreignWt = join(foreign, '.worktrees', 'task-1152-f2fc9924');
  mkdirSync(join(rapitas, '.worktrees', 'task-1'), { recursive: true });
  mkdirSync(join(foreign, '.git'), { recursive: true });
  mkdirSync(foreignWt, { recursive: true });
  mkdirSync(join(root, 'nogit', '.worktrees', 'task-9'), { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveWorktreeBaseDir', () => {
  test('keeps the candidate when the worktree is under it', () => {
    const wt = join(rapitas, '.worktrees', 'task-1');
    expect(resolveWorktreeBaseDir(wt, [rapitas])).toBe(rapitas);
  });

  test('resolves a foreign repo worktree to its parent repository', () => {
    const base = resolveWorktreeBaseDir(foreignWt, [rapitas]);
    expect(isPathSafeForWorktreeOperation(foreignWt, rapitas)).toBe(false);
    expect(isPathSafeForWorktreeOperation(foreignWt, base)).toBe(true);
  });

  test('handles backslash separators', () => {
    const base = resolveWorktreeBaseDir(foreignWt.replace(/\//g, '\\'), [rapitas]);
    expect(base.replace(/\\/g, '/')).toBe(foreign.replace(/\\/g, '/'));
  });

  test('falls back to the first usable candidate when path has ..', () => {
    const wt = `${foreign}/.worktrees/x/../task-1152-f2fc9924`;
    expect(resolveWorktreeBaseDir(wt, [rapitas])).toBe(rapitas);
  });

  test('falls back when the parent has no .git', () => {
    const wt = join(root, 'nogit', '.worktrees', 'task-9');
    expect(resolveWorktreeBaseDir(wt, [rapitas])).toBe(rapitas);
  });

  test('ignores empty/nullish candidates', () => {
    const wt = join(rapitas, '.worktrees', 'task-1');
    expect(resolveWorktreeBaseDir(wt, ['', null, undefined, rapitas])).toBe(rapitas);
  });
});
