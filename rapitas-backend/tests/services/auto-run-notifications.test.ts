/**
 * auto-run-notifications テスト
 *
 * 自動実行のユーザー注意イベント通知（承認待ち・回答待ち・スキップ・全完了）の検証。
 * 同種・同タスクの未読通知がある場合の重複抑止（12秒tickの再発火対策）と、
 * 通知失敗がスケジューリングへ波及しない（握り潰し）ことをカバー。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  notification: {
    findFirst: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
  },
  task: {
    findUnique: mock(() => Promise.resolve({ title: 'テストタスク' })),
  },
  theme: {
    findUnique: mock(() => Promise.resolve({ name: '開発テーマ' })),
  },
};

// NOTE: mock.module is process-global in bun — replacing the config barrel with
// `prisma` alone breaks OTHER test files that import createLogger etc. from the
// barrel in the same run. Mirror every barrel export.
const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config', () => ({
  prisma: mockPrisma,
  logger: noopLogger,
  createLogger: () => noopLogger,
  ensureDatabaseConnection: () => Promise.resolve(),
  getProjectRoot: () => 'C:/Projects/rapitas',
}));

const {
  notifyAwaitingPlanApproval,
  notifyAwaitingUserAnswer,
  notifyTaskSkipped,
  notifyAllDone,
  notifyAllBlocked,
} = await import('../../services/workflow/auto-run/auto-run-notifications');

describe('auto-run-notifications', () => {
  beforeEach(() => {
    mockPrisma.notification.findFirst.mockReset();
    mockPrisma.notification.create.mockReset();
    mockPrisma.task.findUnique.mockReset();
    mockPrisma.theme.findUnique.mockReset();
    mockPrisma.notification.findFirst.mockResolvedValue(null);
    mockPrisma.notification.create.mockResolvedValue({ id: 1 });
    mockPrisma.task.findUnique.mockResolvedValue({ title: 'テストタスク' });
    mockPrisma.theme.findUnique.mockResolvedValue({ name: '開発テーマ' });
  });

  test('承認待ち: タスクタイトル入りの通知を dedupKey 付きで作成すること', async () => {
    await notifyAwaitingPlanApproval(3, 42);

    expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.notification.create.mock.calls[0][0] as {
      data: { type: string; message: string; link: string | null; metadata: string };
    };
    expect(arg.data.type).toBe('auto_run_awaiting_approval');
    expect(arg.data.message).toContain('テストタスク');
    expect(arg.data.link).toBe('/tasks/42');
    expect(JSON.parse(arg.data.metadata).dedupKey).toBe('auto_run_awaiting_approval:42');
  });

  test('同種の未読通知が既にあれば再作成しないこと（dedup）', async () => {
    mockPrisma.notification.findFirst.mockResolvedValue({ id: 99 });

    await notifyAwaitingUserAnswer(3, 42);

    expect(mockPrisma.notification.create).not.toHaveBeenCalled();
  });

  test('スキップ通知: 失敗理由を本文へ含めること', async () => {
    await notifyTaskSkipped(3, 42, 'Max retries (3) exceeded');

    const arg = mockPrisma.notification.create.mock.calls[0][0] as {
      data: { type: string; message: string };
    };
    expect(arg.data.type).toBe('auto_run_task_skipped');
    expect(arg.data.message).toContain('Max retries (3) exceeded');
  });

  test('全完了通知: テーマ名を使い、dedupKey はテーマ単位になること', async () => {
    await notifyAllDone(7);

    const arg = mockPrisma.notification.create.mock.calls[0][0] as {
      data: { message: string; metadata: string };
    };
    expect(arg.data.message).toContain('開発テーマ');
    expect(JSON.parse(arg.data.metadata).dedupKey).toBe('auto_run_all_done:theme-7');
  });

  test('全ブロック通知: 全完了と別 type で、blocked/エスカレーション件数を本文へ含めること（task 615）', async () => {
    await notifyAllBlocked(7, 10, 4);

    const arg = mockPrisma.notification.create.mock.calls[0][0] as {
      data: { type: string; message: string; metadata: string };
    };
    expect(arg.data.type).toBe('auto_run_all_blocked');
    expect(arg.data.message).toContain('10 件');
    expect(arg.data.message).toContain('4 件');
    expect(arg.data.message).toContain('閉塞');
    expect(JSON.parse(arg.data.metadata).dedupKey).toBe('auto_run_all_blocked:theme-7');
  });

  test('通知作成が失敗しても例外を投げないこと（best-effort）', async () => {
    mockPrisma.notification.create.mockRejectedValue(new Error('db down'));

    await expect(notifyAwaitingPlanApproval(3, 42)).resolves.toBeUndefined();
  });
});
