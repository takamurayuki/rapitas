/**
 * Git Cleanup Routes テスト
 * POST /git-cleanup/worktrees が keep-list で稼働中タスクの worktree を保護することを検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockCleanupStale = mock((_baseDir: string, _keepPaths?: string[]) => Promise.resolve(3));
const mockComputeKeep = mock((_baseDir: string): Promise<string[]> => Promise.resolve([]));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));
mock.module('../../../config', () => ({ getProjectRoot: () => '/repo-root' }));
mock.module('../../../services/agents/orchestrator/git-operations', () => ({
  GitOperations: class {
    cleanupStaleWorktrees = mockCleanupStale;
  },
}));
mock.module('../../../services/agents/orchestrator/git-operations/worktree/worktree-ops', () => ({
  cleanupOrphanedWorktrees: mock(() => Promise.resolve(0)),
}));
mock.module('../../../services/agents/worktree-keep-list', () => ({
  computeWorktreeKeepPaths: mockComputeKeep,
}));

const { gitCleanupRoutes } = await import('../../../routes/system/git-cleanup');
const app = new Elysia().use(gitCleanupRoutes);

async function post(body: Record<string, unknown>) {
  const res = await app.handle(
    new Request('http://localhost/git-cleanup/worktrees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return res.json();
}

describe('POST /git-cleanup/worktrees', () => {
  beforeEach(() => {
    mockCleanupStale.mockClear();
    mockComputeKeep.mockClear();
    mockComputeKeep.mockImplementation(() => Promise.resolve([]));
  });

  test('passes the computed keepPaths to cleanupStaleWorktrees', async () => {
    const keep = ['/repo-root/.worktrees/task-1103-a', '/repo-root/.worktrees/task-1112-b'];
    mockComputeKeep.mockImplementation(() => Promise.resolve(keep));

    const json = await post({ workingDirectory: '/custom' });

    expect(mockComputeKeep).toHaveBeenCalledWith('/custom');
    expect(mockCleanupStale).toHaveBeenCalledWith('/custom', keep);
    expect(json.success).toBe(true);
    expect(json.data.cleanedCount).toBe(3);
  });

  test('skips deletion when the keep-list cannot be computed', async () => {
    mockComputeKeep.mockImplementation(() => Promise.reject(new Error('boom')));

    const json = await post({});

    expect(mockCleanupStale).not.toHaveBeenCalled();
    expect(json.success).toBe(false);
  });
});
