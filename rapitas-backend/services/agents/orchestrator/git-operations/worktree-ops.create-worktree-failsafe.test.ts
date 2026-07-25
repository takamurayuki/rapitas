/**
 * worktree-ops.create-worktree-failsafe.test
 *
 * Regression coverage for createWorktree's branch-in-use detection: when the
 * `git worktree list --porcelain` probe throws, the code used to silently
 * proceed as if the branch were free (a debug-only log, swallowed), which let
 * `git worktree add` collide fatally with a branch already checked out
 * elsewhere (task 513 — a retry recomputed the same deterministic branch name
 * and the probe failure meant the collision was never caught). It must now
 * fail SAFE: a probe failure is treated the same as "branch may be in use".
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const mockPrisma = { agentSession: { findMany: mock(() => Promise.resolve([])) } };

mock.module('../../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));
mock.module('./repository-setup', () => ({
  ensureGitRepository: mock(() => Promise.resolve(true)),
  validateAndSetupRemote: mock(() => Promise.resolve(true)),
}));
mock.module('./worktree-preflight', () => ({
  preflightWorktree: mock(() => Promise.resolve()),
}));
mock.module('./git-exec', () => ({
  clearGitCache: mock(() => {}),
}));
mock.module('../../../github/git-exec', () => ({
  clearGitRemoteCache: mock(() => {}),
}));
mock.module('./dependency-installer', () => ({
  awaitWorktreeDependencies: mock(() => Promise.resolve()),
  clearWorktreeDependenciesTracking: mock(() => {}),
}));
mock.module('./safety', () => ({
  WORKTREE_DIR: '.worktrees',
  isPathSafeForWorktreeOperation: mock(() => true),
  normalizePath: mock((path: string) => path.replace(/\\/g, '/')),
}));
const mockExistsSync = mock((_path: string) => false);
mock.module('node:fs', () => ({ existsSync: mockExistsSync }));
mock.module('node:fs/promises', () => ({
  rm: mock(() => Promise.resolve()),
  readdir: mock(() => Promise.resolve([])),
  stat: mock(() => Promise.resolve({ isDirectory: () => false })),
  mkdir: mock(() => Promise.resolve()),
  appendFile: mock(() => Promise.resolve()),
}));

/** Per-test override: how the mocked `git worktree list --porcelain` behaves. */
let worktreeListBehavior: 'in-use' | 'free' | 'probe-fails' = 'free';

const BRANCH = 'feature/implement-task-task-513';
const EXISTING_WORKTREE = 'C:/Projects/trendline/.worktrees/task-513-83e6b1c6';

const execFileCalls: string[] = [];

const mockExecFile = mock((file: string, args: unknown, options: unknown, callback?: unknown) => {
  const argv = Array.isArray(args) ? (args as string[]) : [];
  const cb = (typeof options === 'function' ? options : callback) as
    | ((error: Error | null, result: unknown) => void)
    | undefined;
  const command = [file, ...argv].join(' ');
  execFileCalls.push(command);

  if (command.includes('git worktree list --porcelain')) {
    if (worktreeListBehavior === 'probe-fails') {
      cb?.(new Error('git worktree list failed (simulated)'), undefined);
      return { kill: mock(() => undefined) };
    }
    const stdout =
      worktreeListBehavior === 'in-use'
        ? `worktree /test/repo\nHEAD abcd1234\n\nworktree ${EXISTING_WORKTREE}\nbranch refs/heads/${BRANCH}\n\n`
        : `worktree /test/repo\nHEAD abcd1234\n\n`;
    cb?.(null, { stdout, stderr: '' });
    return { kill: mock(() => undefined) };
  }

  // `git branch --list <effectiveBranchName>` — report it as existing so
  // createWorktree takes the short "branch exists" path (no -b, no base-branch
  // resolution), keeping this test focused on the collision-detection logic.
  if (command.includes('git branch --list')) {
    const branchArg = argv[argv.length - 1];
    cb?.(null, { stdout: `  ${branchArg}\n`, stderr: '' });
    return { kill: mock(() => undefined) };
  }

  cb?.(null, { stdout: '', stderr: '' });
  return { kill: mock(() => undefined) };
});

mock.module('child_process', () => ({ execFile: mockExecFile }));
mock.module('node:child_process', () => ({ execFile: mockExecFile }));

const { createWorktree } = await import('./worktree-ops');

beforeEach(() => {
  execFileCalls.length = 0;
  worktreeListBehavior = 'free';
  mockExistsSync.mockReset().mockReturnValue(false);
});

describe('createWorktree — branch-in-use detection', () => {
  test('suffixes the branch name when the probe succeeds and reports the branch in use', async () => {
    worktreeListBehavior = 'in-use';

    await createWorktree('/test/repo', BRANCH, 513);

    const addCall = execFileCalls.find((c) => c.includes('git worktree add'));
    expect(addCall).toContain(`${BRANCH}-task-513`);
    expect(addCall).not.toContain(`add C:`); // sanity: didn't add the un-suffixed branch
  });

  test('uses the branch name as-is when the probe succeeds and reports it free', async () => {
    worktreeListBehavior = 'free';

    await createWorktree('/test/repo', BRANCH, 513);

    const addCall = execFileCalls.find((c) => c.includes('git worktree add'));
    expect(addCall).toContain(BRANCH);
    expect(addCall).not.toContain(`${BRANCH}-task-513`);
  });

  test('fails SAFE (suffixes the branch) when the list probe itself throws', async () => {
    // Regression: this used to fall through to the un-suffixed branch name,
    // reproducing the exact `git worktree add` collision from task 513.
    worktreeListBehavior = 'probe-fails';

    await createWorktree('/test/repo', BRANCH, 513);

    const addCall = execFileCalls.find((c) => c.includes('git worktree add'));
    expect(addCall).toContain(`${BRANCH}-task-513`);
  });
});

describe('createWorktree — ground-truth reuse of an existing live worktree', () => {
  // Regression (task 513, round 3): the app database can be reset/swapped
  // (e.g. Postgres web mode <-> SQLite desktop mode) independently of what's
  // on disk. A DB-only "does a prior session have a worktree for this task"
  // check then comes up empty even though the worktree is still genuinely
  // alive — this must be caught by asking git itself, not the app DB.
  test('returns the existing path directly and never calls git worktree add', async () => {
    worktreeListBehavior = 'in-use'; // EXISTING_WORKTREE is registered on BRANCH
    // path.join normalizes to platform separators; compare with slashes
    // unified so this doesn't depend on Windows vs POSIX join behavior.
    mockExistsSync.mockImplementation((p: string) => {
      const normalized = p.replace(/\\/g, '/');
      return normalized === EXISTING_WORKTREE || normalized === `${EXISTING_WORKTREE}/.git`;
    });

    const result = await createWorktree('/test/repo', BRANCH, 513);

    expect(result).toBe(EXISTING_WORKTREE);
    expect(execFileCalls.some((c) => c.includes('git worktree add'))).toBe(false);
  });

  test('does not reuse a worktree that exists in git but is gone from disk (phantom)', async () => {
    worktreeListBehavior = 'in-use';
    mockExistsSync.mockReturnValue(false); // nothing on disk — phantom

    await createWorktree('/test/repo', BRANCH, 513);

    // Falls through to the normal branch-in-use suffixing/creation path.
    const addCall = execFileCalls.find((c) => c.includes('git worktree add'));
    expect(addCall).toContain(`${BRANCH}-task-513`);
  });

  test('does not reuse a worktree belonging to a DIFFERENT task', async () => {
    // EXISTING_WORKTREE's dir name is task-513-*; asking for task 999 must
    // not match it, even though it's listed and exists on disk.
    worktreeListBehavior = 'in-use';
    // path.join normalizes to platform separators; compare with slashes
    // unified so this doesn't depend on Windows vs POSIX join behavior.
    mockExistsSync.mockImplementation((p: string) => {
      const normalized = p.replace(/\\/g, '/');
      return normalized === EXISTING_WORKTREE || normalized === `${EXISTING_WORKTREE}/.git`;
    });

    const result = await createWorktree('/test/repo', BRANCH, 999);

    expect(result).not.toBe(EXISTING_WORKTREE);
    expect(execFileCalls.some((c) => c.includes('git worktree add'))).toBe(true);
  });
});
