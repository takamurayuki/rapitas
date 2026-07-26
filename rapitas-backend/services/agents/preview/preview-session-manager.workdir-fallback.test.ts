/**
 * preview-session-manager.workdir-fallback.test
 *
 * startPreview's workdir resolution: prefer the task's latest session
 * worktree when it's still usable, fall back to the theme's working
 * directory when there's no (or no longer usable) worktree — so a task
 * that has never been agent-executed can still be previewed — and fail
 * with 'no_worktree' only when neither is available. Stops short of
 * exercising the actual dev-server launch / Playwright chain (loadRuntimeConfig
 * is mocked to return null, short-circuiting to 'not_configured' right after
 * workdir resolution) so this stays a focused unit test of the resolution
 * logic itself.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import * as realFs from 'fs';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

const mockResolveLatestSessionWorktree = mock(() =>
  Promise.resolve<{ worktreePath: string | null; branchName: string | null } | null>(null),
);
mock.module('../agent-session-resolver', () => ({
  resolveLatestSessionWorktree: mockResolveLatestSessionWorktree,
}));

const mockTaskFindUnique = mock(() => Promise.resolve<Record<string, unknown> | null>(null));
mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: { task: { findUnique: mockTaskFindUnique } },
}));

const mockExistsSync = mock((_p: string) => false);
// mock.module is process-global in bun:test — spread the real module so any
// OTHER export a transitive import needs (e.g. agent-process-tracker's
// readFileSync, pulled in via preview-session-manager's killProcessTreeSafely
// import) stays intact, and only override what this file actually needs.
mock.module('fs', () => ({ ...realFs, existsSync: mockExistsSync }));

const mockLoadRuntimeConfig = mock(() => Promise.resolve<null>(null));
mock.module('../verification/runtime-smoke/runtime-config', () => ({
  loadRuntimeConfig: mockLoadRuntimeConfig,
  substitutePort: (template: string, port: number) => template.split('{port}').join(String(port)),
}));

mock.module('../verification/runtime-smoke/app-launcher', () => ({
  allocateFreePort: mock(() => Promise.resolve(0)),
  launchApp: mock(() => ({ pid: 0, logs: () => [], stop: () => {} })),
  waitForHealthy: mock(() => Promise.resolve(false)),
}));

const { startPreview } = await import('./preview-session-manager');

beforeEach(() => {
  mockResolveLatestSessionWorktree.mockReset().mockResolvedValue(null);
  mockTaskFindUnique.mockReset().mockResolvedValue(null);
  mockExistsSync.mockReset().mockReturnValue(false);
  mockLoadRuntimeConfig.mockReset().mockResolvedValue(null);
});

describe('startPreview — workdir resolution', () => {
  it('uses the session worktree path when it exists on disk', async () => {
    mockResolveLatestSessionWorktree.mockResolvedValue({
      worktreePath: '/repo/.worktrees/task-513-83e6b1c6',
      branchName: 'feature/x',
    });
    mockExistsSync.mockImplementation((p: string) => p === '/repo/.worktrees/task-513-83e6b1c6');

    const result = await startPreview(513);

    expect(mockLoadRuntimeConfig).toHaveBeenCalledWith('/repo/.worktrees/task-513-83e6b1c6');
    expect(mockTaskFindUnique).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      reason: 'not_configured',
      message: 'このプロジェクトには rapitas.runtime.json が設定されていません。',
    });
  });

  it('falls back to the theme working directory when the session worktree is a phantom (gone from disk)', async () => {
    mockResolveLatestSessionWorktree.mockResolvedValue({
      worktreePath: '/repo/.worktrees/task-513-gone',
      branchName: 'feature/x',
    });
    mockTaskFindUnique.mockResolvedValue({ theme: { workingDirectory: '/repo' } });
    // Only the theme dir exists — the recorded worktree does not.
    mockExistsSync.mockImplementation((p: string) => p === '/repo');

    await startPreview(513);

    expect(mockLoadRuntimeConfig).toHaveBeenCalledWith('/repo');
  });

  it('falls back to the theme working directory when the task has no session at all', async () => {
    mockResolveLatestSessionWorktree.mockResolvedValue(null);
    mockTaskFindUnique.mockResolvedValue({ theme: { workingDirectory: '/repo' } });
    mockExistsSync.mockImplementation((p: string) => p === '/repo');

    await startPreview(513);

    expect(mockTaskFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 513 } }),
    );
    expect(mockLoadRuntimeConfig).toHaveBeenCalledWith('/repo');
  });

  it('fails with no_worktree when neither a usable worktree nor a theme working directory exists', async () => {
    mockResolveLatestSessionWorktree.mockResolvedValue(null);
    mockTaskFindUnique.mockResolvedValue({ theme: null });

    const result = await startPreview(513);

    expect(result).toEqual({
      ok: false,
      reason: 'no_worktree',
      message:
        'このタスクのworktreeもテーマの作業ディレクトリも見つかりません。テーマに作業ディレクトリを設定するか、エージェントを一度実行してください。',
    });
    expect(mockLoadRuntimeConfig).not.toHaveBeenCalled();
  });
});
