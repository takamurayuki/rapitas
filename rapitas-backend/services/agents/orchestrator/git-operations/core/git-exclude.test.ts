/**
 * git-exclude.test
 *
 * `info/exclude` lives in the COMMON git directory, so one file is shared by
 * every worktree of a repository. The appender this replaces was unconditional,
 * which re-added the same block on every worktree creation: measured 2026-10-11
 * on rapitas's own checkout, 5547 lines holding 1380 copies of one three-line
 * block, re-parsed by every `git status`, `git add` and `git diff` in the repo
 * and in all of its worktrees. The dedup is the behaviour under test.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendExcludeBlock, resolveExcludeFile } from './git-exclude';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gitexcl-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A main checkout: `.git` is a directory. */
function makeRepo(name: string): string {
  const repo = join(root, name);
  mkdirSync(join(repo, '.git', 'info'), { recursive: true });
  return repo;
}

/** A linked worktree: `.git` is a file pointing into <common>/worktrees/<name>. */
function makeWorktree(repo: string, name: string): string {
  const wt = join(repo, '.worktrees', name);
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', name)}\n`, 'utf8');
  return wt;
}

const lines = (path: string) => readFileSync(path, 'utf8').split(/\r?\n/);

describe('appendExcludeBlock', () => {
  test('writes the comment and patterns when none are present', async () => {
    const file = join(root, 'exclude');
    expect(await appendExcludeBlock(file, 'rapitas agent transient files', ['.wf-tmp.md'])).toBe(
      'added',
    );
    expect(lines(file)).toContain('# rapitas agent transient files');
    expect(lines(file)).toContain('.wf-tmp.md');
  });

  test('writes nothing the second time', async () => {
    const file = join(root, 'exclude');
    await appendExcludeBlock(file, 'c', ['.wf-tmp.md', '.wf-tmp*']);
    expect(await appendExcludeBlock(file, 'c', ['.wf-tmp.md', '.wf-tmp*'])).toBe('already-present');
    expect(lines(file).filter((l) => l === '.wf-tmp.md')).toHaveLength(1);
    expect(lines(file).filter((l) => l === '# c')).toHaveLength(1);
  });

  test('adds only the patterns that are missing', async () => {
    const file = join(root, 'exclude');
    writeFileSync(file, '.wf-tmp.md\n', 'utf8');
    expect(await appendExcludeBlock(file, 'c', ['.wf-tmp.md', '.wf-tmp*'])).toBe('added');
    expect(lines(file).filter((l) => l === '.wf-tmp.md')).toHaveLength(1);
    expect(lines(file).filter((l) => l === '.wf-tmp*')).toHaveLength(1);
  });

  test('matches an existing entry that carries surrounding whitespace', async () => {
    const file = join(root, 'exclude');
    writeFileSync(file, '  .wf-tmp.md  \n', 'utf8');
    expect(await appendExcludeBlock(file, 'c', ['.wf-tmp.md'])).toBe('already-present');
  });

  test('keeps the block on its own lines when the file lacks a trailing newline', async () => {
    const file = join(root, 'exclude');
    writeFileSync(file, 'dist', 'utf8');
    await appendExcludeBlock(file, 'c', ['.wf-tmp.md']);
    expect(lines(file)).toContain('dist');
    expect(lines(file)).toContain('.wf-tmp.md');
  });

  test('creates the parent directory for a fresh exclude file', async () => {
    const file = join(root, 'deep', 'info', 'exclude');
    expect(await appendExcludeBlock(file, 'c', ['x'])).toBe('added');
    expect(lines(file)).toContain('x');
  });

  test('one shared file survives repeated worktree creation', async () => {
    // The regression this module exists for: N worktrees must not produce N copies.
    const repo = makeRepo('many');
    const file = resolveExcludeFile(makeWorktree(repo, 'task-1'));
    if (!file) throw new Error('exclude file should resolve');
    for (let i = 0; i < 5; i++) {
      await appendExcludeBlock(file, 'rapitas agent transient files', ['.wf-tmp.md', '.wf-tmp*']);
    }
    expect(lines(file).filter((l) => l === '.wf-tmp.md')).toHaveLength(1);
  });
});

describe('resolveExcludeFile', () => {
  test('follows a worktree .git file out to the common directory', () => {
    const repo = makeRepo('follow');
    expect(resolveExcludeFile(makeWorktree(repo, 'task-7'))).toBe(
      join(repo, '.git', 'info', 'exclude'),
    );
  });

  test('uses .git directly in a main checkout', () => {
    const repo = makeRepo('main-checkout');
    expect(resolveExcludeFile(repo)).toBe(join(repo, '.git', 'info', 'exclude'));
  });

  test('returns null when there is no .git', () => {
    expect(resolveExcludeFile(join(root, 'nothing-here'))).toBeNull();
  });
});
