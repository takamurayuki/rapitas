/**
 * workflow-activity-logger テスト
 *
 * logAutoPR/logAutoMerge/logAutoMergeFailure が日本語の title/message と
 * metadata.i18n を Notification に書き込むことを検証する(task #763)。
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

const create = mock(() => Promise.resolve({})) as ReturnType<typeof mock>;
const activityLogCreate = mock(() => Promise.resolve({})) as ReturnType<typeof mock>;
const mockPrisma = {
  notification: { create },
  activityLog: { create: activityLogCreate },
};

mock.module('../../config', () => ({
  prisma: mockPrisma,
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

mock.module('../../services/observability', () => ({
  logCycleEvent: () => {},
}));

const { logAutoPR, logAutoMerge, logAutoMergeFailure } = await import('./workflow-activity-logger');

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({});
  activityLogCreate.mockReset();
  activityLogCreate.mockResolvedValue({});
});

describe('logAutoPR', () => {
  test('writes a Japanese title/message and metadata.i18n', async () => {
    await logAutoPR(10, 'テストタスク', 'https://example.com/pr/1', 1);

    const [args] = create.mock.calls[0] as [
      { data: { title: string; message: string; metadata: string } },
    ];
    expect(args.data.title).toBe('自動PR作成完了');
    expect(args.data.message).toContain('テストタスク');
    const metadata = JSON.parse(args.data.metadata) as { i18n: { key: string; params: unknown } };
    expect(metadata.i18n).toEqual({
      key: 'notification.types.auto_pr_created.title',
      params: { taskTitle: 'テストタスク', prUrl: 'https://example.com/pr/1' },
    });
  });
});

describe('logAutoMerge', () => {
  test('writes a Japanese title/message and metadata.i18n', async () => {
    await logAutoMerge(10, 'テストタスク', 1, 'https://example.com/pr/1', 'squash');

    const [args] = create.mock.calls[0] as [
      { data: { title: string; message: string; metadata: string } },
    ];
    expect(args.data.title).toBe('自動マージ完了');
    const metadata = JSON.parse(args.data.metadata) as { i18n: { key: string } };
    expect(metadata.i18n.key).toBe('notification.types.auto_pr_merged.title');
  });
});

describe('logAutoMergeFailure', () => {
  test('writes a Japanese title/message and metadata.i18n', async () => {
    await logAutoMergeFailure(10, 'テストタスク', 1, 'https://example.com/pr/1', 'boom');

    const [args] = create.mock.calls[0] as [
      { data: { title: string; message: string; metadata: string } },
    ];
    expect(args.data.title).toBe('自動マージ失敗');
    const metadata = JSON.parse(args.data.metadata) as { i18n: { key: string } };
    expect(metadata.i18n.key).toBe('notification.types.auto_pr_merge_failed.title');
  });
});
