/**
 * notification-service.test
 *
 * Unit tests for notifyIntakeQuestionPending: the answer-UI link format, the
 * title+link dedup window (suppression inside, creation outside), and time
 * injection via nowMs. All I/O (prisma, SSE broadcast, webhooks) is mocked at
 * the module boundary BEFORE the module under test is imported, so this never
 * touches the database.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const notificationFindFirst = mock((_args: unknown) => Promise.resolve<unknown>(null));
const notificationCreate = mock((args: { data: Record<string, unknown> }) =>
  Promise.resolve({ id: 1, ...args.data }),
);
const notificationCount = mock(() => Promise.resolve(1));
const broadcast = mock(() => {});
const sendWebhookNotification = mock(() => Promise.resolve());

mock.module('../../config/database', () => ({
  prisma: {
    notification: {
      findFirst: notificationFindFirst,
      create: notificationCreate,
      count: notificationCount,
    },
  },
}));
mock.module('./realtime-service', () => ({ realtimeService: { broadcast } }));
mock.module('./webhook-notification-service', () => ({ sendWebhookNotification }));

const {
  notifyIntakeQuestionPending,
  INTAKE_QUESTION_NOTIFICATION_TITLE,
  INTAKE_QUESTION_NOTIFY_WINDOW_MS,
} = await import('./notification-service');

const NOW = Date.parse('2026-08-17T09:00:00.000Z');

describe('notifyIntakeQuestionPending', () => {
  beforeEach(() => {
    notificationFindFirst.mockReset().mockResolvedValue(null);
    notificationCreate
      .mockReset()
      .mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 1, ...args.data }),
      );
    notificationCount.mockReset().mockResolvedValue(1);
    broadcast.mockReset();
  });

  it('creates a system notification whose link reaches the answer UI (/?panel=<id>)', async () => {
    const created = await notifyIntakeQuestionPending({
      taskId: 578,
      taskTitle: '質問待ちのタスク',
      nowMs: NOW,
    });

    expect(created).not.toBeNull();
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    const data = (notificationCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.type).toBe('system');
    expect(data.title).toBe(INTAKE_QUESTION_NOTIFICATION_TITLE);
    // 受入基準2: the link must be the working answer-UI deep link, NOT the
    // route-less conventional /tasks?taskId= (which 404s).
    expect(data.link).toBe('/?panel=578');
    expect(JSON.parse(String(data.metadata))).toEqual({
      taskId: 578,
      reason: 'intake_question_pending',
    });
  });

  it('suppresses (returns null) when a same-title+link notification exists inside the window', async () => {
    notificationFindFirst.mockResolvedValue({ id: 9 });

    const created = await notifyIntakeQuestionPending({
      taskId: 578,
      taskTitle: '質問待ちのタスク',
      nowMs: NOW,
    });

    expect(created).toBeNull();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('dedups by type+title+link with a createdAt window anchored at nowMs', async () => {
    await notifyIntakeQuestionPending({ taskId: 578, taskTitle: 't', nowMs: NOW });

    const where = (
      notificationFindFirst.mock.calls[0]?.[0] as {
        where: { type: string; title: string; link: string; createdAt: { gte: Date } };
      }
    ).where;
    expect(where.type).toBe('system');
    expect(where.title).toBe(INTAKE_QUESTION_NOTIFICATION_TITLE);
    expect(where.link).toBe('/?panel=578');
    expect(NOW - where.createdAt.gte.getTime()).toBe(INTAKE_QUESTION_NOTIFY_WINDOW_MS);
  });

  it('creates independently per task (different link → different dedup key)', async () => {
    await notifyIntakeQuestionPending({ taskId: 578, taskTitle: 'a', nowMs: NOW });
    await notifyIntakeQuestionPending({ taskId: 579, taskTitle: 'b', nowMs: NOW });

    expect(notificationCreate).toHaveBeenCalledTimes(2);
    const links = notificationCreate.mock.calls.map(
      (c) => (c[0] as { data: { link: string } }).data.link,
    );
    expect(links).toEqual(['/?panel=578', '/?panel=579']);
  });
});
