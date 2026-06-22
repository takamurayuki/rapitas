/**
 * canReuseWorktree テスト
 *
 * 直近セッションが記録した worktreePath は、ディスク上に実在する場合のみ再利用可。
 * 実在しない phantom パスを再利用すると、実装/検証フェーズが
 * 「Working directory does not exist」で永久リトライ→blocked になる（task 30 回帰）。
 */
import { describe, test, expect } from 'bun:test';
import { canReuseWorktree } from './workflow-cli-executor';

describe('canReuseWorktree', () => {
  test('記録パスがディスクに実在すれば再利用可', () => {
    expect(canReuseWorktree('C:/Projects/rapitas/.worktrees/task-30-abc', () => true)).toBe(true);
  });

  test('記録パスが実在しなければ再利用しない（再生成へフォールスルー）', () => {
    expect(canReuseWorktree('C:/Projects/rapitas/.worktrees/task-30-abc', () => false)).toBe(false);
  });

  test('記録パスが null/空なら再利用しない', () => {
    expect(canReuseWorktree(null, () => true)).toBe(false);
    expect(canReuseWorktree(undefined, () => true)).toBe(false);
    expect(canReuseWorktree('', () => true)).toBe(false);
  });
});
