/**
 * Tests for git worktree cleanup operations.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, rm as removeDir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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

const mockExec = mock((command: string, options: unknown, callback?: unknown) => {
  const cb = (typeof options === 'function' ? options : callback) as
    | ((error: Error | null, stdout: string, stderr: string) => void)
    | undefined;
  const stdout = command.includes('git worktree list --porcelain') ? worktreeListStdout : '';
  cb?.(null, stdout, '');
  return { kill: mock(() => undefined) };
});

mock.module('../../../../config/database', () => ({ prisma: mockPrisma }));
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
mock.module('./safety', () => ({
  WORKTREE_DIR: '.worktrees',
  isPathSafeForWorktreeOperation: mock(() => true),
  normalizePath: mock((path: string) => path.replace(/\\/g, '/')),
}));

const { cleanupOrphanedWorktrees } = await import('./worktree-ops');

describe('cleanupOrphanedWorktrees', () => {
  const mockBaseDir = '/test/repo';

  beforeEach(() => {
    mockPrisma.agentSession.findMany.mockReset();
    mockPrisma.agentSession.update.mockReset();
    mockExec.mockReset();

    mockPrisma.agentSession.findMany.mockResolvedValue([]);
    mockPrisma.agentSession.update.mockResolvedValue({});
    worktreeListStdout = `worktree /test/repo
HEAD abcd1234

worktree /test/repo/.worktrees/task-123-abc123
branch refs/heads/feature/task-123

`;
    mockExec.mockImplementation((command: string, options: unknown, callback?: unknown) => {
      const cb = (typeof options === 'function' ? options : callback) as
        | ((error: Error | null, stdout: string, stderr: string) => void)
        | undefined;
      const stdout = command.includes('git worktree list --porcelain') ? worktreeListStdout : '';
      cb?.(null, stdout, '');
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

  test.skip('handles filesystem orphans when worktree directory exists', async () => {
    const baseDir = resolve('.tmp-tests/worktree-cleanup');
    const worktreeDir = join(baseDir, '.worktrees');
    await removeDir(baseDir, { recursive: true, force: true });
    await mkdir(join(worktreeDir, 'task-123-abc123'), { recursive: true });
    await mkdir(join(worktreeDir, 'task-999-orphan'), { recursive: true });
    await Bun.write(join(worktreeDir, 'some-file.txt'), 'not a directory');

    worktreeListStdout = `worktree ${baseDir}
HEAD abcd1234

worktree ${join(worktreeDir, 'task-123-abc123')}
branch refs/heads/feature/task-123

`;

    const cleanedCount = await cleanupOrphanedWorktrees(baseDir);

    expect(cleanedCount).toBe(1);
    expect(existsSync(join(worktreeDir, 'task-999-orphan'))).toBe(false);
    expect(existsSync(join(worktreeDir, 'task-123-abc123'))).toBe(true);

    await removeDir(baseDir, { recursive: true, force: true });
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
});
