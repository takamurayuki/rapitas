/**
 * worktree-keep-list テスト
 *
 * 非終端タスクのworktreeが保護されること(blockedも保護)、終端タスクと
 * 存在しないタスクのworktreeは保護されないこと、所有者不明ディレクトリは
 * 常に保護、DB失敗時は全保護(fail-safe)を検証する。
 * Own file — mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

let dirNames: string[] = [];
let readdirShouldFail = false;
mock.module('fs/promises', () => ({
  readdir: mock(() => {
    if (readdirShouldFail) return Promise.reject(new Error('ENOENT'));
    return Promise.resolve(dirNames);
  }),
}));

let liveTaskIds: number[] = [];
let dbShouldFail = false;
const taskFindMany = mock((args: { where: { id: { in: number[] } } }) => {
  if (dbShouldFail) return Promise.reject(new Error('db down'));
  return Promise.resolve(
    liveTaskIds.filter((id) => args.where.id.in.includes(id)).map((id) => ({ id })),
  );
});
mock.module('../../config/database', () => ({ prisma: { task: { findMany: taskFindMany } } }));

const { computeWorktreeKeepPaths, parseTaskIdFromWorktreeName } =
  await import('./worktree-keep-list');

beforeEach(() => {
  dirNames = [];
  liveTaskIds = [];
  readdirShouldFail = false;
  dbShouldFail = false;
  taskFindMany.mockClear();
});

describe('parseTaskIdFromWorktreeName', () => {
  test('task-<id>-<hash> 形式からidを抽出する', () => {
    expect(parseTaskIdFromWorktreeName('task-494-c55f20f3')).toBe(494);
    expect(parseTaskIdFromWorktreeName('task-1-x')).toBe(1);
  });

  test('規約外の名前はnull', () => {
    expect(parseTaskIdFromWorktreeName('scratch')).toBeNull();
    expect(parseTaskIdFromWorktreeName('task-abc-x')).toBeNull();
  });
});

describe('computeWorktreeKeepPaths', () => {
  test('非終端タスク(blocked含む)のworktreeは保護、終端/不存在は保護しない', async () => {
    dirNames = ['task-494-aaaa', 'task-100-bbbb', 'task-999-cccc'];
    liveTaskIds = [494]; // 100=completed想定(クエリが返さない), 999=不存在

    const keep = await computeWorktreeKeepPaths('C:/repo');
    expect(keep).toHaveLength(1);
    expect(keep[0]).toContain('task-494-aaaa');
  });

  test('所有者不明のディレクトリは常に保護される', async () => {
    dirNames = ['task-494-aaaa', 'manual-experiment'];
    liveTaskIds = [];

    const keep = await computeWorktreeKeepPaths('C:/repo');
    expect(keep).toHaveLength(1);
    expect(keep[0]).toContain('manual-experiment');
  });

  test('DB失敗時は全ディレクトリを保護する(fail-safe)', async () => {
    dirNames = ['task-1-a', 'task-2-b'];
    dbShouldFail = true;

    const keep = await computeWorktreeKeepPaths('C:/repo');
    expect(keep).toHaveLength(2);
  });

  test('.worktrees が無ければ空(保護対象なし)', async () => {
    readdirShouldFail = true;
    expect(await computeWorktreeKeepPaths('C:/repo')).toEqual([]);
  });
});
