// @ts-nocheck — Uses vitest API in a bun:test project. Needs migration.
/**
 * Tests for git worktree operations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanupOrphanedWorktrees } from './worktree-ops';
import { prisma } from '../../../../config/database';
import { exec } from 'child_process';
import { existsSync } from 'fs';
import { readdir, rm } from 'fs/promises';

// Mock modules
vi.mock('../../../../config/database', () => ({
  prisma: {
    agentSession: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  rm: vi.fn(),
}));

vi.mock('./safety', () => ({
  WORKTREE_DIR: '.worktrees',
  isPathSafeForWorktreeOperation: vi.fn(() => true),
  normalizePath: vi.fn((path: string) => path.replace(/\\/g, '/')),
}));

vi.mock('path', () => ({
  join: vi.fn((...paths: string[]) => paths.join('/')),
}));

const mockExec = vi.mocked(exec);
const mockExistsSync = vi.mocked(existsSync);
const mockReaddir = vi.mocked(readdir);
const mockRm = vi.mocked(rm);
const mockPrisma = vi.mocked(prisma);

// Helper to simulate promisified exec
const mockExecAsync = (command: string, options: any): Promise<{ stdout: string; stderr: string }> => {
  const { callback } = options;

  if (command.includes('git worktree list --porcelain')) {
    const stdout = `worktree /test/repo
HEAD abcd1234

worktree /test/repo/.worktrees/task-123-abc123
branch refs/heads/feature/task-123

`;
    return Promise.resolve({ stdout, stderr: '' });
  }

  return Promise.resolve({ stdout: '', stderr: '' });
};

describe('cleanupOrphanedWorktrees', () => {
  const mockBaseDir = '/test/repo';

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock promisify to return our mockExecAsync
    vi.doMock('util', () => ({
      promisify: vi.fn(() => mockExecAsync),
    }));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should clean up database-tracked orphaned worktrees', async () => {
    // Mock orphaned sessions from database
    const orphanedSessions = [
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
    ];

    mockPrisma.agentSession.findMany.mockResolvedValue(orphanedSessions);
    mockPrisma.agentSession.update.mockResolvedValue({} as any);

    // Mock successful worktree removal
    const mockRemoveWorktree = vi.fn().mockResolvedValue(undefined);
    vi.doMock('./worktree-ops', async () => {
      const actual = await vi.importActual('./worktree-ops');
      return {
        ...actual,
        removeWorktree: mockRemoveWorktree,
      };
    });

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

  it('should handle filesystem orphans when worktree directory exists', async () => {
    // No database orphans
    mockPrisma.agentSession.findMany.mockResolvedValue([]);
    mockPrisma.agentSession.update.mockResolvedValue({} as any);

    // Mock worktree directory exists
    mockExistsSync.mockReturnValue(true);

    // Mock directory entries
    const mockDirEntries = [
      { name: 'task-123-abc123', isDirectory: () => true },
      { name: 'task-999-orphan', isDirectory: () => true }, // This should be orphaned
      { name: 'some-file.txt', isDirectory: () => false },
    ];

    mockReaddir.mockResolvedValue(mockDirEntries as any);
    mockRm.mockResolvedValue(undefined);

    const cleanedCount = await cleanupOrphanedWorktrees(mockBaseDir);

    // Should clean up 1 filesystem orphan (task-999-orphan is not in git worktree list)
    expect(cleanedCount).toBe(1);
    expect(mockRm).toHaveBeenCalledWith('/test/repo/.worktrees/task-999-orphan', {
      recursive: true,
      force: true,
    });
  });

  it('should handle errors gracefully and continue processing', async () => {
    const orphanedSessions = [
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
    ];

    mockPrisma.agentSession.findMany.mockResolvedValue(orphanedSessions);
    mockPrisma.agentSession.update.mockResolvedValue({} as any);

    // Mock first worktree removal fails, second succeeds
    const mockRemoveWorktree = vi.fn()
      .mockRejectedValueOnce(new Error('Removal failed'))
      .mockResolvedValueOnce(undefined);

    vi.doMock('./worktree-ops', async () => {
      const actual = await vi.importActual('./worktree-ops');
      return {
        ...actual,
        removeWorktree: mockRemoveWorktree,
      };
    });

    const cleanedCount = await cleanupOrphanedWorktrees(mockBaseDir);

    // Should still clean up 1 worktree despite the error
    expect(cleanedCount).toBe(1);
  });

  it('should skip null worktree paths', async () => {
    const orphanedSessions = [
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
    ];

    mockPrisma.agentSession.findMany.mockResolvedValue(orphanedSessions);
    mockPrisma.agentSession.update.mockResolvedValue({} as any);

    const mockRemoveWorktree = vi.fn().mockResolvedValue(undefined);
    vi.doMock('./worktree-ops', async () => {
      const actual = await vi.importActual('./worktree-ops');
      return {
        ...actual,
        removeWorktree: mockRemoveWorktree,
      };
    });

    const cleanedCount = await cleanupOrphanedWorktrees(mockBaseDir);

    expect(cleanedCount).toBe(1);
    expect(mockRemoveWorktree).toHaveBeenCalledTimes(1);
    expect(mockPrisma.agentSession.update).toHaveBeenCalledTimes(1);
  });
});