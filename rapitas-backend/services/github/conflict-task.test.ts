/**
 * conflict-task ユニットテスト
 *
 * 1 PR につき競合解消タスクが常に 1 件に収束する dedup / 再キュー分岐を検証する。
 * （done になった後の再競合で重複行が起票される不具合の回帰テスト）
 */
import { describe, expect, mock, test } from 'bun:test';

// --- prisma モック（動的 import より先に定義すること） ---

interface PriorTask {
  id: number;
  status: string;
  completedAt: Date | null;
}

let mockPrior: PriorTask | null = null;
const calls = { findFirst: 0, update: 0, create: 0 };
let lastUpdateData: Record<string, unknown> | null = null;

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

mock.module('../../config/database', () => ({
  prisma: {
    task: {
      findFirst: () => {
        calls.findFirst += 1;
        return Promise.resolve(mockPrior);
      },
      update: ({ data }: { data: Record<string, unknown> }) => {
        calls.update += 1;
        lastUpdateData = data;
        return Promise.resolve({ id: mockPrior?.id ?? -1 });
      },
      create: () => {
        calls.create += 1;
        return Promise.resolve({ id: 999 });
      },
    },
  },
}));

const { fileConflictResolutionTask } = await import('./conflict-task');

const PR = { prNumber: 265, title: 'X', baseBranch: 'develop', headBranch: 'feat/x-t1' };

function reset(prior: PriorTask | null) {
  mockPrior = prior;
  calls.findFirst = 0;
  calls.update = 0;
  calls.create = 0;
  lastUpdateData = null;
}

describe('fileConflictResolutionTask — 1 PR = 1 タスク収束', () => {
  test('先行タスク無し: 新規作成する', async () => {
    reset(null);
    const r = await fileConflictResolutionTask(PR, '/cwd', 1);
    expect(calls.create).toBe(1);
    expect(calls.update).toBe(0);
    expect(r.created).toBe(true);
    expect(r.taskId).toBe(999);
  });

  test('先行タスクが ACTIVE(blocked): 再利用し新規作成しない', async () => {
    reset({ id: 335, status: 'blocked', completedAt: null });
    const r = await fileConflictResolutionTask(PR, '/cwd', 1);
    expect(calls.create).toBe(0);
    expect(calls.update).toBe(0);
    expect(r).toEqual({ taskId: 335, created: false });
  });

  test('先行タスクが done かつクールダウン経過: 同一行を再キュー（重複行を作らない）', async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000); // 1h 前に完了
    reset({ id: 335, status: 'done', completedAt: old });
    const r = await fileConflictResolutionTask(PR, '/cwd', 1);
    expect(calls.create).toBe(0); // 重複行を作らない
    expect(calls.update).toBe(1); // 既存行を再キュー
    expect(r).toEqual({ taskId: 335, created: true });
    // 完全リセット（todo / workflowStatus クリア / completedAt クリア）
    expect(lastUpdateData?.status).toBe('todo');
    expect(lastUpdateData?.workflowStatus).toBeNull();
    expect(lastUpdateData?.completedAt).toBeNull();
  });

  test('先行タスクが done だがクールダウン中: 再キューせずスキップ', async () => {
    const recent = new Date(Date.now() - 60 * 1000); // 1 分前に完了
    reset({ id: 335, status: 'done', completedAt: recent });
    const r = await fileConflictResolutionTask(PR, '/cwd', 1);
    expect(calls.create).toBe(0);
    expect(calls.update).toBe(0);
    expect(r).toEqual({ taskId: 335, created: false });
  });
});
