/**
 * notify-once-per-window.test
 *
 * The suppression decision, extracted so a fourth copy of this query did not
 * get written (auto-run-no-selection-watch has two, orphan-flag one).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const findFirstMock = mock(() => Promise.resolve(null as { id: number } | null));
mock.module('../../config', () => ({
  prisma: { notification: { findFirst: findFirstMock } },
}));

const createNotificationMock = mock(() => Promise.resolve({}));
mock.module('./notification-service', () => ({ createNotification: createNotificationMock }));

const { notifyOncePerWindow, DEFAULT_RENOTIFY_WINDOW_MS } =
  await import('./notify-once-per-window');

const input = {
  title: 't',
  message: 'm',
  link: '/themes/35',
  nowMs: 10_000_000,
};

describe('notifyOncePerWindow', () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    createNotificationMock.mockClear();
  });

  test('窓内に同じものが無ければ作る', async () => {
    findFirstMock.mockResolvedValueOnce(null);
    expect(await notifyOncePerWindow(input)).toBe(true);
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
  });

  test('窓内に同じものがあれば作らない', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 1 });
    expect(await notifyOncePerWindow(input)).toBe(false);
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  test('重複判定は title と link の両方で、窓の既定は6時間', async () => {
    findFirstMock.mockResolvedValueOnce(null);
    await notifyOncePerWindow(input);
    const [args] = findFirstMock.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args.where).toMatchObject({ title: 't', link: '/themes/35' });
    const gt = (args.where.createdAt as { gt: Date }).gt;
    expect(gt.getTime()).toBe(10_000_000 - DEFAULT_RENOTIFY_WINDOW_MS);
  });

  test('窓は呼び出し側で変えられる', async () => {
    findFirstMock.mockResolvedValueOnce(null);
    await notifyOncePerWindow({ ...input, windowMs: 1_000 });
    const [args] = findFirstMock.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect((args.where.createdAt as { gt: Date }).gt.getTime()).toBe(10_000_000 - 1_000);
  });

  // 一時的な DB エラーで重複を作ると、注意信号が読まれなくなる方向に働く。
  // 報告している状態は持続するので、次の周回で改めて鳴る。
  test('重複判定が失敗したら抑止する（二重通知より黙る方を選ぶ）', async () => {
    findFirstMock.mockRejectedValueOnce(new Error('db down'));
    expect(await notifyOncePerWindow(input)).toBe(false);
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  test('通知作成が失敗しても例外を投げない', async () => {
    findFirstMock.mockResolvedValueOnce(null);
    createNotificationMock.mockRejectedValueOnce(new Error('notify down'));
    expect(await notifyOncePerWindow(input)).toBe(false);
  });
});
