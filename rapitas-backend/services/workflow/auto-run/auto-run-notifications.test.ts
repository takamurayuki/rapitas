/**
 * auto-run-notifications.test
 *
 * Covers the task-618 additions: notifyStallReleased / notifyQueueStarvation
 * create a Notification exactly once (unread dedup suppresses the re-fire) and
 * accept a null themeId (queue-wide starvation is not theme-scoped).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const notificationFindFirstMock = mock(() => Promise.resolve(null as { id: number } | null));
const notificationCreateMock = mock(() => Promise.resolve({}));
const taskFindUniqueMock = mock(() => Promise.resolve({ title: 'stalled task' }));
const themeFindUniqueMock = mock(() => Promise.resolve({ name: 'テストテーマ' }));

mock.module('../../../config', () => ({
  prisma: {
    notification: { findFirst: notificationFindFirstMock, create: notificationCreateMock },
    task: { findUnique: taskFindUniqueMock },
    theme: { findUnique: themeFindUniqueMock },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));

const { notifyStallReleased, notifyQueueStarvation, notifyResourceContentionHold } =
  await import('./auto-run-notifications');

beforeEach(() => {
  notificationFindFirstMock.mockReset().mockResolvedValue(null);
  notificationCreateMock.mockReset().mockResolvedValue({});
  taskFindUniqueMock.mockReset().mockResolvedValue({ title: 'stalled task' });
  themeFindUniqueMock.mockReset().mockResolvedValue({ name: 'テストテーマ' });
});

describe('notifyStallReleased', () => {
  test('creates one notification with the task-scoped dedup key', async () => {
    await notifyStallReleased(1, 617, 2, 'terminal_task_active_item_residue');

    expect(notificationCreateMock).toHaveBeenCalledTimes(1);
    const data = (
      notificationCreateMock.mock.calls[0]?.[0] as { data: { type: string; metadata: string } }
    ).data;
    expect(data.type).toBe('auto_run_stall_released');
    expect(JSON.parse(data.metadata).dedupKey).toBe('auto_run_stall_released:617');
  });

  test('an existing UNREAD notification of the same scope suppresses re-creation', async () => {
    notificationFindFirstMock.mockResolvedValue({ id: 9 });

    await notifyStallReleased(1, 617, 1, 'terminal_task_running_residue');
    await notifyStallReleased(1, 617, 1, 'terminal_task_running_residue');

    expect(notificationCreateMock).not.toHaveBeenCalled();
  });

  test('themeId=null でも正常に作成される（テーマ非スコープの残留）', async () => {
    await notifyStallReleased(null, 620, 1, 'stale_running_no_live_execution');

    expect(notificationCreateMock).toHaveBeenCalledTimes(1);
    const data = (notificationCreateMock.mock.calls[0]?.[0] as { data: { metadata: string } }).data;
    expect(JSON.parse(data.metadata).themeId).toBeNull();
  });
});

describe('notifyQueueStarvation', () => {
  test('taskId=null は queue-global の dedup キーで作成される', async () => {
    await notifyQueueStarvation(null, 4);

    expect(notificationCreateMock).toHaveBeenCalledTimes(1);
    const data = (
      notificationCreateMock.mock.calls[0]?.[0] as { data: { type: string; metadata: string } }
    ).data;
    expect(data.type).toBe('auto_run_queue_starved');
    expect(JSON.parse(data.metadata).dedupKey).toBe('auto_run_queue_starved:global');
  });

  test('連続呼出しでも未読が残っている間は1回しか作成されない', async () => {
    await notifyQueueStarvation(617, 3);
    // 1回目の作成後は未読が存在する状態をシミュレート。
    notificationFindFirstMock.mockResolvedValue({ id: 10 });
    await notifyQueueStarvation(617, 4);

    expect(notificationCreateMock).toHaveBeenCalledTimes(1);
  });
});

describe('notifyResourceContentionHold', () => {
  test('creates one notification with the theme-scoped dedup key', async () => {
    await notifyResourceContentionHold(42, 91, 85);

    expect(notificationCreateMock).toHaveBeenCalledTimes(1);
    const data = (
      notificationCreateMock.mock.calls[0]?.[0] as { data: { type: string; metadata: string } }
    ).data;
    expect(data.type).toBe('auto_run_resource_hold');
    expect(JSON.parse(data.metadata).dedupKey).toBe('auto_run_resource_hold:theme-42');
  });

  test('連続2tick呼び出しでも未読が残っている間は1件しか作成されない', async () => {
    await notifyResourceContentionHold(42, 91, 85);
    // 1回目の作成後は未読が存在する状態をシミュレート。
    notificationFindFirstMock.mockResolvedValue({ id: 11 });
    await notifyResourceContentionHold(42, 93, 85);

    expect(notificationCreateMock).toHaveBeenCalledTimes(1);
  });
});
