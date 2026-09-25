/**
 * worktree-create restore test
 *
 * Pins the branch start point when no local branch exists: resume from
 * origin/<branch> (tracking it) when the task branch was already pushed, else
 * cut a fresh --no-track branch from origin/<base>. 2026-09-25 #911: a
 * re-created worktree started at origin/develop, dropping the task's pushed
 * commits and tracking the base branch.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const mockPrisma = { agentSession: { findMany: mock(() => Promise.resolve([])) } };
mock.module('../../../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('./repository-setup', () => ({
  ensureGitRepository: mock(() => Promise.resolve(true)),
  validateAndSetupRemote: mock(() => Promise.resolve(true)),
}));
mock.module('./worktree-preflight', () => ({ preflightWorktree: mock(() => Promise.resolve()) }));
mock.module('../core/git-exec', () => ({ clearGitCache: mock(() => {}) }));
mock.module('../../../../github/git-exec', () => ({ clearGitRemoteCache: mock(() => {}) }));
mock.module('./dependency-installer', () => ({
  awaitWorktreeDependencies: mock(() => Promise.resolve()),
  clearWorktreeDependenciesTracking: mock(() => {}),
}));
mock.module('../core/safety', () => ({
  WORKTREE_DIR: '.worktrees',
  isPathSafeForWorktreeOperation: mock(() => true),
  normalizePath: mock((path: string) => path.replace(/\\/g, '/')),
}));
mock.module('../../../../../utils/common/branch-name-generator', () => ({
  hasTaskIdMarker: (branchName: string, taskId: number) =>
    new RegExp(`(?:^|[/-])t${taskId}(?:[/-]|$)`).test(branchName),
}));
mock.module('node:fs', () => ({ existsSync: mock(() => false) }));
mock.module('node:fs/promises', () => ({
  rm: mock(() => Promise.resolve()),
  readdir: mock(() => Promise.resolve([])),
  stat: mock(() => Promise.resolve({ isDirectory: () => false })),
  mkdir: mock(() => Promise.resolve()),
  appendFile: mock(() => Promise.resolve()),
}));

const BRANCH = 'feature/t911-update-task';
/** Remote refs `git branch -r --list <ref>` reports as existing. */
let remoteRefs: Set<string> = new Set();
const execFileCalls: string[][] = [];

const mockExecFile = mock((file: string, args: unknown, options: unknown, callback?: unknown) => {
  const argv = Array.isArray(args) ? (args as string[]) : [];
  const cb = (typeof options === 'function' ? options : callback) as
    | ((error: Error | null, result: unknown) => void)
    | undefined;
  execFileCalls.push([file, ...argv]);
  let stdout = '';
  if (argv[0] === 'worktree' && argv[1] === 'list')
    stdout = 'worktree /test/repo\nHEAD abcd1234\n\n';
  // The only local branch is develop (the base); the task branch is gone.
  if (argv[0] === 'branch' && argv[1] === '--list' && argv[2] === 'develop') stdout = '  develop\n';
  if (argv[0] === 'branch' && argv[1] === '-r') {
    const ref = argv[argv.length - 1]!;
    stdout = remoteRefs.has(ref) ? `  ${ref}\n` : '';
  }
  cb?.(null, { stdout, stderr: '' });
  return { kill: mock(() => undefined) };
});
mock.module('child_process', () => ({ execFile: mockExecFile }));
mock.module('node:child_process', () => ({ execFile: mockExecFile }));

const { createWorktree } = await import('./worktree-ops');

function addCall(): string[] | undefined {
  return execFileCalls.find((c) => c[1] === 'worktree' && c[2] === 'add');
}

beforeEach(() => {
  execFileCalls.length = 0;
  remoteRefs = new Set(['origin/develop']);
});

describe('createWorktree — start point when the local branch is gone', () => {
  test('resumes from origin/<branch> (tracking it) when the task branch was pushed', async () => {
    remoteRefs.add(`origin/${BRANCH}`);

    await createWorktree('/test/repo', BRANCH, 911, null, 'develop');

    const add = addCall();
    expect(add).toBeDefined();
    expect(add!.slice(2)).toEqual([
      'add',
      '--track',
      '-b',
      BRANCH,
      expect.stringContaining('task-911-'),
      `origin/${BRANCH}`,
    ]);
    // The remote ref is refreshed before the probe, so a just-pushed branch is seen.
    expect(execFileCalls.some((c) => c.join(' ') === `git fetch origin ${BRANCH}`)).toBe(true);
  });

  test('cuts a fresh --no-track branch from origin/<base> when nothing was pushed yet', async () => {
    await createWorktree('/test/repo', BRANCH, 911, null, 'develop');

    const add = addCall();
    expect(add).toBeDefined();
    expect(add!.slice(2)).toEqual([
      'add',
      '--no-track',
      '-b',
      BRANCH,
      expect.stringContaining('task-911-'),
      'origin/develop',
    ]);
  });

  test('the default-base fallback path is --no-track as well', async () => {
    await createWorktree('/test/repo', BRANCH, 911);

    const add = addCall();
    expect(add).toBeDefined();
    expect(add![3]).toBe('--no-track');
    expect(add![add!.length - 1]).toBe('origin/develop');
  });
});
