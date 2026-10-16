/**
 * repository-setup.test
 *
 * ensureGitRepository: existing repo is a no-op; a fresh directory is
 * `git init`-ed and, only when it has zero commits, seeded with an initial
 * commit + `develop` branch (Git-flow) and an optional remote; any failure in
 * that init sequence must be caught and reported as `false`, never thrown.
 *
 * validateAndSetupRemote: matching remote is left alone, a mismatched remote
 * is repointed via `set-url`, a missing remote is created via `remote add`,
 * and any exec failure is caught and reported as `false`.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

type ExecCallback = (error: Error | null, result?: { stdout: string; stderr: string }) => void;
type ExecOutcome = { error?: Error; stdout?: string };

const execCalls: string[] = [];
let behaviors: Array<{ match: string; outcome: ExecOutcome }> = [];

/** Registers a canned outcome for the first exec call whose command contains `match`. */
function setBehavior(match: string, outcome: ExecOutcome): void {
  behaviors.push({ match, outcome });
}

function resetExecMock(): void {
  execCalls.length = 0;
  behaviors = [];
}

const mockExec = mock((command: string, optsOrCb: unknown, cb?: ExecCallback) => {
  // NOTE: promisify(exec) passes (cmd, opts, callback) — support both arities.
  const callback = (typeof optsOrCb === 'function' ? optsOrCb : cb) as ExecCallback;
  execCalls.push(command);
  const rule = behaviors.find((b) => command.includes(b.match));
  if (rule?.outcome.error) {
    callback(rule.outcome.error);
    return;
  }
  callback(null, { stdout: rule?.outcome.stdout ?? '', stderr: '' });
});

// NOTE: Mirror ALL child_process exports (both specifiers) — bun mock.module is
// process-global; sibling git-operations modules (core-ops.ts, worktree-ops.ts,
// branch-pr-ops.ts) import execFile, not exec.
const mockExecFile = mock(() => {});
mock.module('child_process', () => ({ exec: mockExec, execFile: mockExecFile }));
mock.module('node:child_process', () => ({ exec: mockExec, execFile: mockExecFile }));

mock.module('../../../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

const { ensureGitRepository, validateAndSetupRemote } = await import('./repository-setup');

const TMP_ROOT = resolve('.tmp-tests/repository-setup');

describe('ensureGitRepository', () => {
  beforeEach(async () => {
    resetExecMock();
    await rm(TMP_ROOT, { recursive: true, force: true });
    await mkdir(TMP_ROOT, { recursive: true });
  });

  afterEach(async () => {
    await rm(TMP_ROOT, { recursive: true, force: true });
  });

  test('returns true immediately when the directory is already a git repository', async () => {
    const dir = join(TMP_ROOT, 'existing-repo');
    await mkdir(dir, { recursive: true });
    // Default (no behavior registered) resolves successfully → "is a repo".

    const result = await ensureGitRepository(dir);

    expect(result).toBe(true);
    expect(execCalls).toEqual(['git rev-parse --git-dir']);
  });

  test('inits but skips seeding when the new repository already has commits', async () => {
    const dir = join(TMP_ROOT, 'init-has-commits');
    await mkdir(dir, { recursive: true });
    setBehavior('--git-dir', { error: new Error('not a git repository') });
    // 'git init' and 'rev-parse HEAD' both default to success.

    const result = await ensureGitRepository(dir);

    expect(result).toBe(true);
    expect(execCalls).toEqual(['git rev-parse --git-dir', 'git init', 'git rev-parse HEAD']);
    expect(existsSync(join(dir, '.gitkeep'))).toBe(false);
  });

  test('seeds an initial commit + develop branch for a brand-new repo with no URL', async () => {
    const dir = join(TMP_ROOT, 'init-fresh-no-url');
    await mkdir(dir, { recursive: true });
    setBehavior('--git-dir', { error: new Error('not a git repository') });
    setBehavior('rev-parse HEAD', { error: new Error('no commits yet') });

    const result = await ensureGitRepository(dir);

    expect(result).toBe(true);
    expect(existsSync(join(dir, '.gitkeep'))).toBe(true);
    expect(execCalls).toEqual([
      'git rev-parse --git-dir',
      'git init',
      'git rev-parse HEAD',
      'git add .gitkeep',
      'git commit -m "Initial commit"',
      'git branch develop',
      'git checkout develop',
    ]);
  });

  test('configures the remote for a brand-new repo when a repositoryUrl is given', async () => {
    const dir = join(TMP_ROOT, 'init-fresh-with-url');
    await mkdir(dir, { recursive: true });
    setBehavior('--git-dir', { error: new Error('not a git repository') });
    setBehavior('rev-parse HEAD', { error: new Error('no commits yet') });
    setBehavior('remote get-url origin', { error: new Error('no such remote') });

    const result = await ensureGitRepository(dir, 'https://example.com/repo.git');

    expect(result).toBe(true);
    expect(execCalls).toContain('git remote add origin "https://example.com/repo.git"');
  });

  test('returns false when `git init` itself fails', async () => {
    const dir = join(TMP_ROOT, 'init-fails');
    await mkdir(dir, { recursive: true });
    setBehavior('--git-dir', { error: new Error('not a git repository') });
    setBehavior('git init', { error: new Error('permission denied') });

    const result = await ensureGitRepository(dir);

    expect(result).toBe(false);
    expect(execCalls).toEqual(['git rev-parse --git-dir', 'git init']);
  });

  test('returns false when a step in the seeding sequence fails (e.g. commit)', async () => {
    const dir = join(TMP_ROOT, 'init-commit-fails');
    await mkdir(dir, { recursive: true });
    setBehavior('--git-dir', { error: new Error('not a git repository') });
    setBehavior('rev-parse HEAD', { error: new Error('no commits yet') });
    setBehavior('commit -m', { error: new Error('nothing configured to commit as') });

    const result = await ensureGitRepository(dir);

    expect(result).toBe(false);
    // The branch/checkout steps after the failed commit must never run.
    expect(execCalls).not.toContain('git branch develop');
    expect(execCalls).not.toContain('git checkout develop');
  });
});

describe('validateAndSetupRemote', () => {
  beforeEach(() => {
    resetExecMock();
  });

  test('returns true and makes no exec calls when no repositoryUrl is given', async () => {
    const result = await validateAndSetupRemote('/repo', undefined);

    expect(result).toBe(true);
    expect(execCalls).toEqual([]);
  });

  test('returns true and makes no exec calls when repositoryUrl is null', async () => {
    const result = await validateAndSetupRemote('/repo', null);

    expect(result).toBe(true);
    expect(execCalls).toEqual([]);
  });

  test('leaves a matching remote untouched', async () => {
    setBehavior('remote get-url origin', { stdout: 'https://example.com/repo.git\n' });

    const result = await validateAndSetupRemote('/repo', 'https://example.com/repo.git');

    expect(result).toBe(true);
    expect(execCalls).toEqual(['git remote get-url origin']);
  });

  test('repoints a mismatched remote via set-url', async () => {
    setBehavior('remote get-url origin', { stdout: 'https://old.example.com/repo.git\n' });

    const result = await validateAndSetupRemote('/repo', 'https://new.example.com/repo.git');

    expect(result).toBe(true);
    expect(execCalls).toContain('git remote set-url origin "https://new.example.com/repo.git"');
  });

  test('adds the remote when none is configured yet', async () => {
    setBehavior('remote get-url origin', { error: new Error('no such remote') });

    const result = await validateAndSetupRemote('/repo', 'https://example.com/repo.git');

    expect(result).toBe(true);
    expect(execCalls).toContain('git remote add origin "https://example.com/repo.git"');
  });

  test('returns false when both get-url and add fail', async () => {
    setBehavior('remote get-url origin', { error: new Error('no such remote') });
    setBehavior('remote add origin', { error: new Error('permission denied') });

    const result = await validateAndSetupRemote('/repo', 'https://example.com/repo.git');

    expect(result).toBe(false);
  });
});
