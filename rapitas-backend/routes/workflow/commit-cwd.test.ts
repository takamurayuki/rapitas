/**
 * commit-cwd.test
 *
 * Fixtures mirror task 774 (2026-08-30): config rows lost to stale-execution
 * recovery, work stranded in .worktrees/task-774-6a4a22c3.
 */
import { describe, test, expect, mock } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { findTaskWorktreeDir, resolveCommitCwd } = await import('./commit-cwd');
const { join } = await import('path');

const THEME = 'C:/Projects/rapitas';
const listDir = async (dir: string) => {
  if (dir === join(THEME, '.worktrees')) return ['task-774-6a4a22c3', 'task-775-deadbeef'];
  throw new Error('ENOENT');
};

describe('findTaskWorktreeDir', () => {
  test('task-<id>- で始まる worktree を返す', async () => {
    expect(await findTaskWorktreeDir(THEME, 774, listDir)).toBe(
      join(THEME, '.worktrees', 'task-774-6a4a22c3'),
    );
  });
  test('無ければ null（別タスク・fs エラー・themeDir 無し）', async () => {
    expect(await findTaskWorktreeDir(THEME, 999, listDir)).toBeNull();
    expect(await findTaskWorktreeDir('C:/elsewhere', 774, listDir)).toBeNull();
    expect(await findTaskWorktreeDir(null, 774, listDir)).toBeNull();
  });
});

describe('resolveCommitCwd', () => {
  test('明示 cwd が最優先', async () => {
    expect(
      await resolveCommitCwd(
        { workingDirectory: 'C:/explicit' },
        { theme: { workingDirectory: THEME } },
        774,
        listDir,
      ),
    ).toBe('C:/explicit');
  });
  test('設定消失時は worktree を使う（task 774 再発防止）', async () => {
    expect(await resolveCommitCwd(null, { theme: { workingDirectory: THEME } }, 774, listDir)).toBe(
      join(THEME, '.worktrees', 'task-774-6a4a22c3'),
    );
  });
  test('worktree も無ければ従来どおりテーマディレクトリ', async () => {
    expect(
      await resolveCommitCwd(undefined, { theme: { workingDirectory: THEME } }, 999, listDir),
    ).toBe(THEME);
    expect(await resolveCommitCwd(undefined, null, 999, listDir)).toBeUndefined();
  });
});
