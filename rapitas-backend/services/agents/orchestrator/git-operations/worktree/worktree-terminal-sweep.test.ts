/**
 * worktree-terminal-sweep テスト
 *
 * 終端タスクのclean worktreeはsession行なしでも削除、keep登録分は保護、
 * dirty拒否はバックオフ記録、DBが終端と確認しないidは触らないことを検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

let dirNames: string[] = [];
mock.module('node:fs/promises', () => ({ readdir: mock(() => Promise.resolve(dirNames)) }));

let terminalIds: number[] = [];
const taskFindMany = mock((args: { where: { id: { in: number[] } } }) =>
  Promise.resolve(terminalIds.filter((i) => args.where.id.in.includes(i)).map((id) => ({ id }))),
);
mock.module('../../../../../config/database', () => ({
  prisma: { task: { findMany: taskFindMany } },
}));

let refuse = new Set<string>();
const removeWorktree = mock((_base: string, p: string) =>
  Promise.resolve(![...refuse].some((r) => p.includes(r))),
);
mock.module('./worktree-remove', () => ({ removeWorktree }));

const { sweepTerminalTaskWorktrees } = await import('./worktree-terminal-sweep');
const { resetRemovalBackoff, parkedRemovalCount } = await import('./worktree-removal-backoff');

beforeEach(() => {
  dirNames = [];
  terminalIds = [];
  refuse = new Set();
  removeWorktree.mockClear();
  taskFindMany.mockClear();
  resetRemovalBackoff();
});

describe('sweepTerminalTaskWorktrees', () => {
  test('AC1/AC2: 終端タスクのclean worktreeをsession行なしで削除する', async () => {
    dirNames = ['task-999-aaaa'];
    terminalIds = [999];
    expect(await sweepTerminalTaskWorktrees('C:/repo', new Set())).toBe(1);
    expect(removeWorktree).toHaveBeenCalledTimes(1);
  });

  test('AC3: keep登録分は削除しない', async () => {
    dirNames = ['task-1-aaaa'];
    terminalIds = [1];
    const keep = new Set(['C:/repo/.worktrees/task-1-aaaa']);
    expect(await sweepTerminalTaskWorktrees('C:/repo', keep)).toBe(0);
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  test('DBが終端と確認しないid(非終端/不存在)と規約外名は触らない', async () => {
    dirNames = ['task-5-aaaa', 'scratch'];
    terminalIds = [];
    expect(await sweepTerminalTaskWorktrees('C:/repo', new Set())).toBe(0);
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  test('dirty拒否は件数に加えずバックオフへ記録する', async () => {
    dirNames = ['task-7-aaaa'];
    terminalIds = [7];
    refuse = new Set(['task-7-']);
    expect(await sweepTerminalTaskWorktrees('C:/repo', new Set())).toBe(0);
    expect(parkedRemovalCount()).toBe(1);
    await sweepTerminalTaskWorktrees('C:/repo', new Set());
    expect(removeWorktree).toHaveBeenCalledTimes(1); // 2回目はクールダウンでスキップ
  });
});
