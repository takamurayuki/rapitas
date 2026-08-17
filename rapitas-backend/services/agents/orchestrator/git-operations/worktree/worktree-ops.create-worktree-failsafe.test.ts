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
mock.module('./worktree-preflight', () => ({
  preflightWorktree: mock(() => Promise.resolve()),
}));
mock.module('../core/git-exec', () => ({
  clearGitCache: mock(() => {}),
}));
mock.module('../../../../github/git-exec', () => ({
  clearGitRemoteCache: mock(() => {}),
}));
mock.module('./dependency-installer', () => ({
  awaitWorktreeDependencies: mock(() => Promise.resolve()),
  clearWorktreeDependenciesTracking: mock(() => {}),
}));
mock.module('../core/safety', () => ({
  WORKTREE_DIR: '.worktrees',
  isPathSafeForWorktreeOperation: mock(() => true),
  normalizePath: mock((path: string) => path.replace(/\\/g, '/')),
}));
// NOTE: worktree-ops imports hasTaskIdMarker from branch-name-generator, whose
// real module pulls in the whole ai-client dependency chain (fs/child_process/
// config) — far beyond what this test's minimal node-primitive mocks provide.
// hasTaskIdMarker is a pure function covered directly by
// branch-name-generator.test.ts; mirror its logic here to keep this module
// graph small.
mock.module('../../../../../utils/common/branch-name-generator', () => ({
  hasTaskIdMarker: (branchName: string, taskId: number) =>
    new RegExp(`(?:^|[/-])t${taskId}(?:[/-]|$)`).test(branchName),
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

/** Per-test override: which branch the mocked worktree list reports as in use. */
let inUseBranch: string;

// Canonical branch-name format from branch-name-generator: `<prefix>/t<taskId>-<slug>`.
const BRANCH = 'feature/t513-implement-task';
// Legacy format without the `t<taskId>` marker (pre-task-539 branches,
// naming-service suggestions) — must keep the old `-task-<id>` suffixing.
const LEGACY_BRANCH = 'feature/legacy-name';
const EXISTING_WORKTREE = 'C:/Projects/trendline/.worktrees/task-513-83e6b1c6';

const execFileCalls: string[] = [];

/**
 * Extract the branch argument of the recorded `git worktree add` call.
 * The mocked `git branch --list` always reports the branch as existing, so the
 * add is invoked WITHOUT `-b`: `git worktree add <path> <branch>` — the branch
 * is the last token (paths in these tests contain no spaces).
 */
function addedBranchArg(): string | undefined {
  const addCall = execFileCalls.find((c) => c.includes('git worktree add'));
  return addCall?.split(' ').pop();
}

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
        ? `worktree /test/repo\nHEAD abcd1234\n\nworktree ${EXISTING_WORKTREE}\nbranch refs/heads/${inUseBranch}\n\n`
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
  inUseBranch = BRANCH;
  mockExistsSync.mockReset().mockReturnValue(false);
});

describe('createWorktree — branch-in-use detection', () => {
  test('suffixes the branch name when the probe succeeds and reports the branch in use', async () => {
    worktreeListBehavior = 'in-use';

    await createWorktree('/test/repo', BRANCH, 513);

    const branchArg = addedBranchArg();
    expect(branchArg).toMatch(new RegExp(`^${BRANCH}-[0-9a-f]{8}$`));
    expect(execFileCalls.find((c) => c.includes('git worktree add'))).not.toContain(`add C:`); // sanity: didn't add the un-suffixed branch
  });

  test('does NOT embed the task id twice when a canonical (t<id>-marked) name collides', async () => {
    // Regression: the old suffixing appended `-task-513` unconditionally, so a
    // name already carrying `t513` became `feature/...-t513-...-task-513`
    // (the double-suffix bug, e.g. `feature/implement-perf-t319-task-319`).
    worktreeListBehavior = 'in-use';

    await createWorktree('/test/repo', BRANCH, 513);

    const branchArg = addedBranchArg();
    expect(branchArg).toBeDefined();
    expect(branchArg).not.toContain('task-513');
    // Exactly one occurrence of the task id in the BRANCH NAME itself
    // (the worktree PATH also contains task-513 — inspect only the branch arg).
    expect(branchArg!.match(/513/g)).toHaveLength(1);
  });

  test('keeps the legacy -task-<id> suffix for names WITHOUT the t<id> marker (backward compat)', async () => {
    worktreeListBehavior = 'in-use';
    inUseBranch = LEGACY_BRANCH;

    await createWorktree('/test/repo', LEGACY_BRANCH, 513);

    const branchArg = addedBranchArg();
    expect(branchArg).toBe(`${LEGACY_BRANCH}-task-513`);
  });

  test('uses the branch name as-is when the probe succeeds and reports it free', async () => {
    worktreeListBehavior = 'free';

    await createWorktree('/test/repo', BRANCH, 513);

    const branchArg = addedBranchArg();
    expect(branchArg).toBe(BRANCH);
  });

  test('fails SAFE (suffixes the branch) when the list probe itself throws', async () => {
    // Regression: this used to fall through to the un-suffixed branch name,
    // reproducing the exact `git worktree add` collision from task 513.
    worktreeListBehavior = 'probe-fails';

    await createWorktree('/test/repo', BRANCH, 513);

    const branchArg = addedBranchArg();
    expect(branchArg).toMatch(new RegExp(`^${BRANCH}-[0-9a-f]{8}$`));
  });

  test('fails SAFE with the legacy -task-<id> suffix for unmarked names when the probe throws', async () => {
    worktreeListBehavior = 'probe-fails';

    await createWorktree('/test/repo', LEGACY_BRANCH, 513);

    const branchArg = addedBranchArg();
    expect(branchArg).toBe(`${LEGACY_BRANCH}-task-513`);
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

    // Falls through to the normal branch-in-use suffixing/creation path
    // (shortId suffix — BRANCH already carries the t513 marker).
    expect(addedBranchArg()).toMatch(new RegExp(`^${BRANCH}-[0-9a-f]{8}$`));
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
