/**
 * Notification Service テスト
 * 通知作成と各種通知ヘルパー関数のテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockNotification = {
  id: 1,
  type: 'system',
  title: 'Test',
  message: 'Test message',
  link: null,
  metadata: null,
  isRead: false,
  createdAt: new Date(),
};

const mockPrisma = {
  notification: {
    create: mock(() => Promise.resolve(mockNotification)),
    count: mock(() => Promise.resolve(3)),
  },
};

const mockBroadcast = mock(() => {});

mock.module('../../config/database', () => ({
  prisma: mockPrisma,
}));

mock.module('../../services/communication/realtime-service', () => ({
  realtimeService: {
    broadcast: mockBroadcast,
  },
}));

const {
  createNotification,
  notifyTaskCompleted,
  notifyAgentExecutionCompleted,
  notifyApprovalRequested,
  notifyPomodoroCompleted,
} = await import('../../services/communication/notification-service');

describe('createNotification', () => {
  beforeEach(() => {
    mockPrisma.notification.create.mockReset();
    mockPrisma.notification.create.mockResolvedValue(mockNotification);
    mockPrisma.notification.count.mockReset();
    mockPrisma.notification.count.mockResolvedValue(3);
    mockBroadcast.mockReset();
  });

  test('通知を作成しSSEでブロードキャストすること', async () => {
    await createNotification({
      type: 'system',
      title: 'Test',
      message: 'Test message',
    });

    expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
    expect(mockBroadcast).toHaveBeenCalledWith(
      'notifications',
      'new_notification',
      expect.objectContaining({
        notification: mockNotification,
        unreadCount: 3,
      }),
    );
  });

  test('metadataをJSON文字列に変換すること', async () => {
    await createNotification({
      type: 'system',
      title: 'Test',
      message: 'Test',
      metadata: { key: 'value' },
    });

    const createCall = mockPrisma.notification.create.mock.calls[0]![0] as {
      data: { metadata: string };
    };
    expect(createCall.data.metadata).toBe(JSON.stringify({ key: 'value' }));
  });

  test('metadataがない場合nullを設定すること', async () => {
    await createNotification({
      type: 'system',
      title: 'Test',
      message: 'Test',
    });

    const createCall = mockPrisma.notification.create.mock.calls[0]![0] as {
      data: { metadata: string | null };
    };
    expect(createCall.data.metadata).toBeNull();
  });
});

describe('notifyTaskCompleted', () => {
  beforeEach(() => {
    mockPrisma.notification.create.mockReset();
    mockPrisma.notification.create.mockResolvedValue(mockNotification);
    mockPrisma.notification.count.mockReset();
    mockPrisma.notification.count.mockResolvedValue(0);
    mockBroadcast.mockReset();
  });

  test('正しいtype/title/message/link/metadataで通知を作成すること', async () => {
    await notifyTaskCompleted(42, 'テストタスク');

    const createCall = mockPrisma.notification.create.mock.calls[0]![0] as {
      data: { type: string; title: string; message: string; link: string; metadata: string };
    };
    expect(createCall.data.type).toBe('task_completed');
    expect(createCall.data.title).toBe('タスク完了');
    expect(createCall.data.message).toContain('テストタスク');
    expect(createCall.data.link).toBe('/tasks?taskId=42');
    expect(JSON.parse(createCall.data.metadata)).toEqual({ taskId: 42 });
  });
});

describe('notifyAgentExecutionCompleted', () => {
  beforeEach(() => {
    mockPrisma.notification.create.mockReset();
    mockPrisma.notification.create.mockResolvedValue(mockNotification);
    mockPrisma.notification.count.mockReset();
    mockPrisma.notification.count.mockResolvedValue(0);
    mockBroadcast.mockReset();
  });

  test('成功時にagent_execution_completedタイプで通知すること', async () => {
    await notifyAgentExecutionCompleted(1, 'AI Task', true);

    const createCall = mockPrisma.notification.create.mock.calls[0]![0] as {
      data: { type: string; title: string; message: string };
    };
    expect(createCall.data.type).toBe('agent_execution_completed');
    expect(createCall.data.title).toBe('AI実行完了');
    expect(createCall.data.message).toContain('完了しました');
  });

  test('失敗時にagent_execution_failedタイプで通知すること', async () => {
    await notifyAgentExecutionCompleted(1, 'AI Task', false);

    const createCall = mockPrisma.notification.create.mock.calls[0]![0] as {
      data: { type: string; title: string; message: string };
    };
    expect(createCall.data.type).toBe('agent_execution_failed');
    expect(createCall.data.title).toBe('AI実行失敗');
    expect(createCall.data.message).toContain('失敗しました');
  });
});

describe('notifyApprovalRequested', () => {
  beforeEach(() => {
    mockPrisma.notification.create.mockReset();
    mockPrisma.notification.create.mockResolvedValue(mockNotification);
    mockPrisma.notification.count.mockReset();
    mockPrisma.notification.count.mockResolvedValue(0);
    mockBroadcast.mockReset();
  });

  test('承認リクエスト通知を作成すること', async () => {
    await notifyApprovalRequested(5, 'PR Review');

    const createCall = mockPrisma.notification.create.mock.calls[0]![0] as {
      data: { type: string; title: string; link: string; metadata: string };
    };
    expect(createCall.data.type).toBe('approval_requested');
    expect(createCall.data.link).toBe('/approvals');
    expect(JSON.parse(createCall.data.metadata)).toEqual({ approvalId: 5 });
  });
});

describe('notifyPomodoroCompleted', () => {
  beforeEach(() => {
    mockPrisma.notification.create.mockReset();
    mockPrisma.notification.create.mockResolvedValue(mockNotification);
    mockPrisma.notification.count.mockReset();
    mockPrisma.notification.count.mockResolvedValue(0);
    mockBroadcast.mockReset();
  });

  test('タスク名ありの場合タスク名を含めること', async () => {
    await notifyPomodoroCompleted('Study Math', 3);

    const createCall = mockPrisma.notification.create.mock.calls[0]![0] as {
      data: { message: string };
    };
    expect(createCall.data.message).toContain('Study Math');
    expect(createCall.data.message).toContain('#3');
  });

  test('タスク名なしの場合ポモドーロ番号のみ含めること', async () => {
    await notifyPomodoroCompleted(null, 5);

    const createCall = mockPrisma.notification.create.mock.calls[0]![0] as {
      data: { message: string };
    };
    expect(createCall.data.message).not.toContain('「');
    expect(createCall.data.message).toContain('#5');
  });
});
