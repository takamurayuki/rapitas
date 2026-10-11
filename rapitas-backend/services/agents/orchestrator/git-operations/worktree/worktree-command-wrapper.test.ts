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
  test('copies the wrapper into a worktree that lacks it', async () => {
    const wt = makeWorktree(makeRepo('temporaid'), 'task-1183');

    expect(await ensureRunCheckedWrapper(wt, source)).toBe('copied');
    expect(readFileSync(join(wt, WRAPPER_RELATIVE_PATH), 'utf8')).toBe('// heartbeat wrapper\n');
  });

  test('never overwrites a project that already has one', async () => {
    // A project that grows its own wrapper owns that path: replacing it would
    // change what the project's CI and contributors run.
    const wt = makeWorktree(makeRepo('own-wrapper'), 'task-1');
    mkdirSync(join(wt, 'scripts'), { recursive: true });
    writeFileSync(join(wt, WRAPPER_RELATIVE_PATH), '// the project own\n', 'utf8');

    expect(await ensureRunCheckedWrapper(wt, source)).toBe('present');
    expect(readFileSync(join(wt, WRAPPER_RELATIVE_PATH), 'utf8')).toBe('// the project own\n');
  });

  test('reports a missing source instead of creating an empty file', async () => {
    const wt = makeWorktree(makeRepo('no-source'), 'task-1');

    expect(await ensureRunCheckedWrapper(wt, join(root, 'absent.cjs'))).toBe('source-missing');
    expect(existsSync(join(wt, WRAPPER_RELATIVE_PATH))).toBe(false);
  });

  test("adds the wrapper to the repository's local exclude list", async () => {
    const repo = makeRepo('excluded');
    await ensureRunCheckedWrapper(makeWorktree(repo, 'task-1'), source);

    // `git add .` must not be able to carry rapitas's tooling into the app repo.
    const exclude = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split(/\r?\n/)).toContain(WRAPPER_RELATIVE_PATH);
  });

  test('still provisions the wrapper when the exclude file cannot be resolved', async () => {
    // No `.git` at all: the wrapper is what the agent needs, and losing the
    // exclude only means `git status` shows it.
    const wt = join(root, 'bare');
    mkdirSync(wt, { recursive: true });

    expect(await ensureRunCheckedWrapper(wt, source)).toBe('copied');
    expect(existsSync(join(wt, WRAPPER_RELATIVE_PATH))).toBe(true);
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
