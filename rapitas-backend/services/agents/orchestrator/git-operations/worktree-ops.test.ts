/**
 * Tests for git worktree cleanup operations.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';

const mockPrisma = {
  agentSession: {
    findMany: mock(() => Promise.resolve([])),
    update: mock(() => Promise.resolve({})),
  },
};

let worktreeListStdout = `worktree /test/repo
HEAD abcd1234

worktree /test/repo/.worktrees/task-123-abc123
branch refs/heads/feature/task-123

`;

// NOTE: util.promisify(exec) resolves with the FIRST callback argument. To simulate the
// real exec behaviour (which uses util.promisify.custom to return { stdout, stderr }),
// we pass { stdout, stderr } as the first callback arg so destructuring works in the module.
const makeExecResult = (command: string) => ({
  stdout: command.includes('git worktree list --porcelain') ? worktreeListStdout : '',
  stderr: '',
});

const mockExec = mock((command: string, options: unknown, callback?: unknown) => {
  const cb = (typeof options === 'function' ? options : callback) as
    | ((error: Error | null, result: unknown) => void)
    | undefined;
  cb?.(null, makeExecResult(command));
  return { kill: mock(() => undefined) };
});

const mockExistsSync = mock((_path: string) => false);
const mockFsRm = mock(() => Promise.resolve(undefined));
const mockReaddir = mock(() => Promise.resolve([]));
const mockStat = mock(() =>
  Promise.resolve({ isDirectory: () => false } as import('node:fs').Stats),
);
const mockAwaitWorktreeDependencies = mock(() => Promise.resolve());
const mockClearWorktreeDependenciesTracking = mock(() => {});

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
mock.module('child_process', () => ({ exec: mockExec }));
mock.module('node:child_process', () => ({ exec: mockExec }));
mock.module('node:fs', () => ({
  existsSync: mockExistsSync,
}));
mock.module('node:fs/promises', () => ({
  rm: mockFsRm,
  readdir: mockReaddir,
  stat: mockStat,
  mkdir: mock(() => Promise.resolve()),
  appendFile: mock(() => Promise.resolve()),
}));
mock.module('./safety', () => ({
  WORKTREE_DIR: '.worktrees',
  isPathSafeForWorktreeOperation: mock(() => true),
  normalizePath: mock((path: string) => path.replace(/\\/g, '/')),
}));
mock.module('./dependency-installer', () => ({
  awaitWorktreeDependencies: mockAwaitWorktreeDependencies,
  clearWorktreeDependenciesTracking: mockClearWorktreeDependenciesTracking,
}));

const { cleanupOrphanedWorktrees, removeWorktree, rmDirWithRetry } = await import('./worktree-ops');

// ---------------------------------------------------------------------------
// rmDirWithRetry
// ---------------------------------------------------------------------------

describe('rmDirWithRetry', () => {
  const noopSleep = () => Promise.resolve();

  beforeEach(() => {
    mockFsRm.mockReset();
    mockFsRm.mockResolvedValue(undefined);
  });

  test('returns true on first-attempt success', async () => {
    const result = await rmDirWithRetry('/test/dir', { sleepFn: noopSleep });
    expect(result).toBe(true);
    expect(mockFsRm).toHaveBeenCalledTimes(1);
  });

  test('returns true after EBUSY failures then success', async () => {
    let callCount = 0;
    mockFsRm.mockImplementation(() => {
      callCount++;
      if (callCount < 4) {
        const err = Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
        return Promise.reject(err);
      }
      return Promise.resolve(undefined);
    });

    const result = await rmDirWithRetry('/test/dir', { sleepFn: noopSleep, maxAttempts: 5 });

    expect(result).toBe(true);
    expect(mockFsRm).toHaveBeenCalledTimes(4);
  });

  test('returns false after all attempts fail and does not throw', async () => {
    const ebusyErr = Object.assign(new Error('EBUSY: resource busy or locked'), {
      code: 'EBUSY',
    });
    mockFsRm.mockImplementation(() => Promise.reject(ebusyErr));

    let thrownError: unknown;
    let result: boolean | undefined;
    try {
      result = await rmDirWithRetry('/test/dir', { sleepFn: noopSleep, maxAttempts: 5 });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeUndefined();
    expect(result).toBe(false);
    expect(mockFsRm).toHaveBeenCalledTimes(5);
  });
});

// ---------------------------------------------------------------------------
// removeWorktree
// ---------------------------------------------------------------------------

describe('removeWorktree', () => {
  const mockBaseDir = '/test/repo';
  const mockWorktreePath = '/test/repo/.worktrees/task-123-abc123';

  beforeEach(() => {
    mockExistsSync.mockReset();
    mockExistsSync.mockImplementation(() => false);
    mockFsRm.mockReset();
    mockFsRm.mockResolvedValue(undefined);
    mockAwaitWorktreeDependencies.mockReset();
    mockAwaitWorktreeDependencies.mockResolvedValue(undefined);
    mockClearWorktreeDependenciesTracking.mockReset();

    mockExec.mockReset();
    mockExec.mockImplementation((command: string, options: unknown, callback?: unknown) => {
      const cb = (typeof options === 'function' ? options : callback) as
        | ((error: Error | null, result: unknown) => void)
        | undefined;
      cb?.(null, makeExecResult(command));
      return { kill: mock(() => undefined) };
    });
  });

  test('calls awaitWorktreeDependencies before git worktree remove', async () => {
    const callOrder: string[] = [];

    mockAwaitWorktreeDependencies.mockImplementation(async () => {
      callOrder.push('awaitDependencies');
    });

    mockExec.mockImplementation((command: string, options: unknown, callback?: unknown) => {
      const cb = (typeof options === 'function' ? options : callback) as
        | ((error: Error | null, result: unknown) => void)
        | undefined;
      if (command.includes('git worktree remove')) {
        callOrder.push('gitWorktreeRemove');
      }
      cb?.(null, makeExecResult(command));
      return { kill: mock(() => undefined) };
    });

    await removeWorktree(mockBaseDir, mockWorktreePath, false);

    const awaitIdx = callOrder.indexOf('awaitDependencies');
    const removeIdx = callOrder.indexOf('gitWorktreeRemove');
    expect(awaitIdx).toBeGreaterThanOrEqual(0);
    expect(removeIdx).toBeGreaterThanOrEqual(0);
    expect(awaitIdx).toBeLessThan(removeIdx);
  });

  test('calls clearWorktreeDependenciesTracking after removal', async () => {
    await removeWorktree(mockBaseDir, mockWorktreePath, false);
    expect(mockClearWorktreeDependenciesTracking).toHaveBeenCalledWith(mockWorktreePath);
  });

  test('attempts rm when git worktree remove fails and directory exists', async () => {
    mockExec.mockImplementation((command: string, options: unknown, callback?: unknown) => {
      const cb = (typeof options === 'function' ? options : callback) as
        | ((error: Error | null, result: unknown) => void)
        | undefined;
      if (command.includes('git worktree remove')) {
        cb?.(new Error('git error'), undefined);
      } else {
        cb?.(null, makeExecResult(command));
      }
      return { kill: mock(() => undefined) };
    });

    // Only the worktree root exists (no .git sub-directory)
    mockExistsSync.mockImplementation((p: string) => p === mockWorktreePath);

    await removeWorktree(mockBaseDir, mockWorktreePath, false);

    expect(mockFsRm).toHaveBeenCalledWith(mockWorktreePath, { recursive: true, force: true });
  });

  test('continues gracefully when awaitWorktreeDependencies rejects', async () => {
    mockAwaitWorktreeDependencies.mockImplementation(() =>
      Promise.reject(new Error('setup failed')),
    );

    // Should not throw even when awaitWorktreeDependencies rejects
    let thrownError: unknown;
    try {
      await removeWorktree(mockBaseDir, mockWorktreePath, false);
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// cleanupOrphanedWorktrees
// ---------------------------------------------------------------------------

describe('cleanupOrphanedWorktrees', () => {
  const mockBaseDir = '/test/repo';

  beforeEach(() => {
    mockPrisma.agentSession.findMany.mockReset();
    mockPrisma.agentSession.update.mockReset();
    mockExec.mockReset();
    mockExistsSync.mockReset();
    mockFsRm.mockReset();
    mockReaddir.mockReset();
    mockAwaitWorktreeDependencies.mockReset();

    mockPrisma.agentSession.findMany.mockResolvedValue([]);
    mockPrisma.agentSession.update.mockResolvedValue({});
    mockExistsSync.mockImplementation(() => false);
    mockFsRm.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([]);
    mockAwaitWorktreeDependencies.mockResolvedValue(undefined);
    worktreeListStdout = `worktree /test/repo
HEAD abcd1234

worktree /test/repo/.worktrees/task-123-abc123
branch refs/heads/feature/task-123

`;
    mockExec.mockImplementation((command: string, options: unknown, callback?: unknown) => {
      const cb = (typeof options === 'function' ? options : callback) as
        | ((error: Error | null, result: unknown) => void)
        | undefined;
      cb?.(null, makeExecResult(command));
      return { kill: mock(() => undefined) };
    });
  });

  test('cleans up database-tracked orphaned worktrees', async () => {
    mockPrisma.agentSession.findMany.mockResolvedValue([
      {
        id: 1,
        worktreePath: '/test/repo/.worktrees/task-123-abc123',
        status: 'completed',
      },
      {
        id: 2,
        worktreePath: '/test/repo/.worktrees/task-456-def456',
        status: 'failed',
      },
    ] as never);

    const cleanedCount = await cleanupOrphanedWorktrees(mockBaseDir);

    expect(cleanedCount).toBe(2);
    expect(mockPrisma.agentSession.findMany).toHaveBeenCalledWith({
      where: {
        worktreePath: { not: null },
        status: { in: ['completed', 'failed', 'cancelled'] },
      },
      select: {
        id: true,
        worktreePath: true,
        status: true,
      },
    });
    expect(mockPrisma.agentSession.update).toHaveBeenCalledTimes(2);
  });

  test('continues processing multiple database-tracked worktrees', async () => {
    mockPrisma.agentSession.findMany.mockResolvedValue([
      {
        id: 1,
        worktreePath: '/test/repo/.worktrees/task-123-abc123',
        status: 'completed',
      },
      {
        id: 2,
        worktreePath: '/test/repo/.worktrees/task-456-def456',
        status: 'failed',
      },
    ] as never);

    const cleanedCount = await cleanupOrphanedWorktrees(mockBaseDir);

    expect(cleanedCount).toBe(2);
    expect(mockPrisma.agentSession.update).toHaveBeenCalledTimes(2);
  });

  test('skips null worktree paths', async () => {
    mockPrisma.agentSession.findMany.mockResolvedValue([
      {
        id: 1,
        worktreePath: null,
        status: 'completed',
      },
      {
        id: 2,
        worktreePath: '/test/repo/.worktrees/task-456-def456',
        status: 'failed',
      },
    ] as never);

    const cleanedCount = await cleanupOrphanedWorktrees(mockBaseDir);

    expect(cleanedCount).toBe(1);
    expect(mockPrisma.agentSession.update).toHaveBeenCalledTimes(1);
  });

  test('filesystem orphan: EBUSY all attempts does not throw and cleanup loop continues', async () => {
    const ebusyErr = Object.assign(new Error('EBUSY: resource busy or locked'), {
      code: 'EBUSY',
    });
    // NOTE: Inject a no-op sleepFn so retries do not incur real 1-4s waits.
    const noopSleep = () => Promise.resolve();

    // NOTE: Set all mocks inline so this test doesn't depend on beforeEach residue.
    // Return true for all existsSync paths — no DB sessions, so removeWorktree is never called.
    mockPrisma.agentSession.findMany.mockImplementation(() => Promise.resolve([]));
    mockFsRm.mockImplementation(() => Promise.reject(ebusyErr));
    mockExistsSync.mockImplementation(() => true);
    mockReaddir.mockImplementation(() =>
      Promise.resolve([
        { name: 'task-orphan-aaa', isDirectory: () => true },
        { name: 'task-orphan-bbb', isDirectory: () => true },
      ]),
    );
    // Both orphan paths are NOT in the git tracked list (worktreeListStdout only has task-123-abc123)

    let thrownError: unknown;
    let result: number | undefined;
    try {
      result = await cleanupOrphanedWorktrees(mockBaseDir, { sleepFn: noopSleep });
    } catch (err) {
      thrownError = err;
    }

    // Must not throw
    expect(thrownError).toBeUndefined();
    // Orphans that failed are not counted
    expect(result).toBe(0);
    // rm was attempted (exact path is platform-specific; just verify it was invoked)
    expect(mockFsRm).toHaveBeenCalled();
  });

  test('filesystem orphan: successful rm increments count', async () => {
    // NOTE: Inject a no-op sleepFn to avoid real waits on any retry path.
    const noopSleep = () => Promise.resolve();
    // NOTE: Set all mocks inline for isolation.
    mockPrisma.agentSession.findMany.mockImplementation(() => Promise.resolve([]));
    mockFsRm.mockImplementation(() => Promise.resolve(undefined));
    mockExistsSync.mockImplementation(() => true);
    mockReaddir.mockImplementation(() =>
      Promise.resolve([{ name: 'task-orphan-xyz', isDirectory: () => true }]),
    );
    // git list does NOT include task-orphan-xyz → it's an orphan

    const result = await cleanupOrphanedWorktrees(mockBaseDir, { sleepFn: noopSleep });

    expect(result).toBe(1);
    expect(mockFsRm).toHaveBeenCalledWith(expect.stringContaining('task-orphan-xyz'), {
      recursive: true,
      force: true,
    });
  });
});
