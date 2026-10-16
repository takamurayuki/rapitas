/**
 * memo-reminder-scheduler tests — due-reminder firing and one-shot semantics.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  memo: {
    findMany: mock(() => Promise.resolve([] as unknown[])),
    update: mock(() => Promise.resolve({ id: 1 })),
  },
};
const mockCreateNotification = mock(() => Promise.resolve({ id: 1 }));

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));
mock.module('../communication/notification-service', () => ({
  createNotification: mockCreateNotification,
}));

const { fireDueMemoReminders } = await import('./memo-reminder-scheduler');

const NOW = new Date('2026-08-05T09:00:00Z');

beforeEach(() => {
  mockPrisma.memo.findMany.mockReset();
  mockPrisma.memo.update.mockReset();
  mockCreateNotification.mockReset();
  mockPrisma.memo.findMany.mockResolvedValue([]);
  mockPrisma.memo.update.mockResolvedValue({ id: 1 });
  mockCreateNotification.mockResolvedValue({ id: 1 });
});

describe('fireDueMemoReminders', () => {
  test('期限到来メモに通知を作成し remindedAt を刻印する', async () => {
    mockPrisma.memo.findMany.mockResolvedValue([
      { id: 5, content: '牛乳を買う', remindAt: NOW, remindedAt: null, isDone: false },
    ]);
    const fired = await fireDueMemoReminders(NOW);
    expect(fired).toBe(1);
    expect(mockPrisma.memo.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { remindedAt: NOW },
    });
    const call = mockCreateNotification.mock.calls[0]![0] as unknown as {
      type: string;
      message: string;
      link: string;
    };
    expect(call.type).toBe('memo_reminder');
    expect(call.message).toBe('牛乳を買う');
    expect(call.link).toBe('/memos');
  });

  test('クエリは 未発火・未完了・期限到来 のみを対象にする', async () => {
    await fireDueMemoReminders(NOW);
    const arg = mockPrisma.memo.findMany.mock.calls[0]![0] as unknown as {
      where: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ remindAt: { lte: NOW }, remindedAt: null, isDone: false });
  });

  test('長文は120字+省略記号に切り詰める', async () => {
    mockPrisma.memo.findMany.mockResolvedValue([
      { id: 6, content: 'あ'.repeat(200), remindAt: NOW, remindedAt: null, isDone: false },
    ]);
    await fireDueMemoReminders(NOW);
    const call = mockCreateNotification.mock.calls[0]![0] as unknown as { message: string };
    expect(call.message).toBe(`${'あ'.repeat(120)}…`);
  });

  test('通知作成に失敗したら remindedAt を戻して次回再試行できる', async () => {
    mockPrisma.memo.findMany.mockResolvedValue([
      { id: 7, content: 'x', remindAt: NOW, remindedAt: null, isDone: false },
    ]);
    mockCreateNotification.mockRejectedValue(new Error('boom'));
    await fireDueMemoReminders(NOW);
    expect(mockPrisma.memo.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { remindedAt: null },
    });
  });

  test('期限到来メモが無ければ何もしない', async () => {
    const fired = await fireDueMemoReminders(NOW);
    expect(fired).toBe(0);
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });
});
