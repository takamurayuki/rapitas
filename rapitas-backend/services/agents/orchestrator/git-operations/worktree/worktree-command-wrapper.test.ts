/**
 * worktree-command-wrapper.test
 *
 * Every implementer and verifier prompt tells the agent to verify through
 * `node scripts/run-checked.cjs` — the only thing that prints a heartbeat every
 * 30s. That script ships with rapitas and is absent from a generated project,
 * where Claude Code's ~301s no-output kill then truncates the agent mid-write.
 * These tests pin the provisioning and, just as importantly, that the copy can
 * never be committed into the generated app's repository.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureRunCheckedWrapper,
  resolveExcludeFile,
  defaultWrapperSource,
  WRAPPER_RELATIVE_PATH,
} from './worktree-command-wrapper';

let root: string;
let source: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wcw-'));
  source = join(root, 'rapitas-scripts', 'run-checked.cjs');
  mkdirSync(join(root, 'rapitas-scripts'), { recursive: true });
  writeFileSync(source, '// heartbeat wrapper\n', 'utf8');
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

describe('ensureRunCheckedWrapper', () => {
  test('copies the wrapper into a worktree that lacks it', () => {
    const repo = makeRepo('temporaid');
    const wt = makeWorktree(repo, 'task-1183');

    expect(ensureRunCheckedWrapper(wt, source)).toBe('copied');
    expect(readFileSync(join(wt, WRAPPER_RELATIVE_PATH), 'utf8')).toBe('// heartbeat wrapper\n');
  });

  test('never overwrites a project that already has one', () => {
    const repo = makeRepo('own-wrapper');
    const wt = makeWorktree(repo, 'task-1');
    mkdirSync(join(wt, 'scripts'), { recursive: true });
    writeFileSync(join(wt, WRAPPER_RELATIVE_PATH), '// the project own\n', 'utf8');

    expect(ensureRunCheckedWrapper(wt, source)).toBe('present');
    expect(readFileSync(join(wt, WRAPPER_RELATIVE_PATH), 'utf8')).toBe('// the project own\n');
  });

  test('reports a missing source instead of creating an empty file', () => {
    const repo = makeRepo('no-source');
    const wt = makeWorktree(repo, 'task-1');

    expect(ensureRunCheckedWrapper(wt, join(root, 'absent.cjs'))).toBe('source-missing');
    expect(existsSync(join(wt, WRAPPER_RELATIVE_PATH))).toBe(false);
  });

  test("adds the wrapper to the repository's local exclude list", () => {
    const repo = makeRepo('excluded');
    const wt = makeWorktree(repo, 'task-1');

    ensureRunCheckedWrapper(wt, source);

    // `git add .` must not be able to carry rapitas's tooling into the app repo.
    const exclude = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split(/\r?\n/)).toContain(WRAPPER_RELATIVE_PATH);
  });

  test('does not duplicate the exclude entry across worktrees of one repo', () => {
    const repo = makeRepo('two-worktrees');
    writeFileSync(join(repo, '.git', 'info', 'exclude'), 'node_modules\n', 'utf8');

    ensureRunCheckedWrapper(makeWorktree(repo, 'task-1'), source);
    ensureRunCheckedWrapper(makeWorktree(repo, 'task-2'), source);

    const lines = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8').split(/\r?\n/);
    expect(lines.filter((l) => l === WRAPPER_RELATIVE_PATH)).toHaveLength(1);
    // The pre-existing content survives.
    expect(lines).toContain('node_modules');
  });

  test('appends on its own line when the exclude file has no trailing newline', () => {
    const repo = makeRepo('no-trailing-newline');
    writeFileSync(join(repo, '.git', 'info', 'exclude'), 'dist', 'utf8');

    ensureRunCheckedWrapper(makeWorktree(repo, 'task-1'), source);

    const lines = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8').split(/\r?\n/);
    expect(lines).toContain('dist');
    expect(lines).toContain(WRAPPER_RELATIVE_PATH);
  });

  test('still provisions the wrapper when the exclude file cannot be resolved', () => {
    // No `.git` at all: the wrapper is what the agent needs; losing the exclude
    // only means `git status` shows it.
    const wt = join(root, 'bare');
    mkdirSync(wt, { recursive: true });

    expect(ensureRunCheckedWrapper(wt, source)).toBe('copied');
    expect(existsSync(join(wt, WRAPPER_RELATIVE_PATH))).toBe(true);
  });
});

describe('resolveExcludeFile', () => {
  test('follows a worktree .git file out to the common directory', () => {
    const repo = makeRepo('follow');
    const wt = makeWorktree(repo, 'task-7');
    expect(resolveExcludeFile(wt)).toBe(join(repo, '.git', 'info', 'exclude'));
  });

  test('uses .git directly in a main checkout', () => {
    const repo = makeRepo('main-checkout');
    expect(resolveExcludeFile(repo)).toBe(join(repo, '.git', 'info', 'exclude'));
  });

  test('returns null when there is no .git', () => {
    expect(resolveExcludeFile(join(root, 'nothing-here'))).toBeNull();
  });
});

describe('defaultWrapperSource', () => {
  test("resolves rapitas's own wrapper from this module's directory", () => {
    // Pinned so a future folder move cannot silently stop provisioning: the
    // function would start returning a path that does not exist and every
    // generated project would quietly lose its heartbeat again.
    expect(defaultWrapperSource(import.meta.dir).replace(/\\/g, '/')).toEndWith(
      '/rapitas/scripts/run-checked.cjs',
    );
    expect(existsSync(defaultWrapperSource(import.meta.dir))).toBe(true);
  });
});
