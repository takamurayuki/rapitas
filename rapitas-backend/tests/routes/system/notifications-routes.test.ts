/**
 * Notifications Routes テスト
 * 通知CRUD操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  notification: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    updateMany: mock(() => Promise.resolve({ count: 0 })),
    delete: mock(() => Promise.resolve({})),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
    count: mock(() => Promise.resolve(0)),
  },
};

mock.module('../../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));
mock.module('../../../services/realtime-service', () => ({
  realtimeService: {
    registerClient: mock(() => 'client-1'),
    registerStreamController: mock(() => {}),
    broadcast: mock(() => {}),
  },
}));
mock.module('../../../services/cache-service', () => ({
  cacheService: {
    get: mock(() => null),
    set: mock(() => {}),
    delete: mock(() => {}),
  },
}));

const { notificationsRoutes } = await import('../../../routes/system/notifications');
const { AppError } = await import('../../../middleware/error-handler');

function resetAllMocks() {
  for (const model of Object.values(mockPrisma)) {
    if (typeof model === 'object' && model !== null) {
      for (const method of Object.values(model)) {
        if (typeof method === 'function' && 'mockReset' in method) {
          (method as ReturnType<typeof mock>).mockReset();
        }
      }
    }
  }
}

function createApp() {
  return new Elysia()
    .onError(({ code, error, set }) => {
      if (error instanceof AppError) {
        set.status = error.statusCode;
        return { error: error.message, code: error.code };
      }
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: 'Validation error' };
      }
      set.status = 500;
      return {
        error: error instanceof Error ? error.message : 'Server error',
      };
    })
    .use(notificationsRoutes);
}

describe('GET /notifications', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('全通知を返すこと', async () => {
    const notifications = [
      {
        id: 1,
        title: 'タスク完了',
        message: 'タスクが完了しました',
        isRead: false,
        createdAt: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 2,
        title: 'リマインダー',
        message: '期限が近づいています',
        isRead: true,
        createdAt: '2026-03-02T00:00:00.000Z',
      },
    ];
    mockPrisma.notification.findMany.mockResolvedValue(notifications);

    const res = await app.handle(new Request('http://localhost/notifications'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
  });

  test('空配列を返すこと', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/notifications'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  test('unreadOnlyフィルタを適用すること', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);

    await app.handle(new Request('http://localhost/notifications?unreadOnly=true'));

    const call = mockPrisma.notification.findMany.mock.calls[0]![0] as {
      where?: { isRead: boolean };
    };
    expect(call.where).toEqual({ isRead: false });
  });
});

describe('GET /notifications/unread-count', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('未読数を返すこと', async () => {
    mockPrisma.notification.count.mockResolvedValue(5);

    const res = await app.handle(new Request('http://localhost/notifications/unread-count'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.count).toBe(5);
  });

  test('未読がない場合に0を返すこと', async () => {
    mockPrisma.notification.count.mockResolvedValue(0);

    const res = await app.handle(new Request('http://localhost/notifications/unread-count'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.count).toBe(0);
  });
});

describe('PATCH /notifications/:id/read', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('通知を既読にすること', async () => {
    const updated = {
      id: 1,
      isRead: true,
      readAt: new Date().toISOString(),
    };
    mockPrisma.notification.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/notifications/1/read', {
        method: 'PATCH',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isRead).toBe(true);
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/notifications/abc/read', {
        method: 'PATCH',
      }),
    );

    expect(res.status).toBe(400);
  });
});

describe('POST /notifications/mark-all-read', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('全通知を既読にすること', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 });

    const res = await app.handle(
      new Request('http://localhost/notifications/mark-all-read', {
        method: 'POST',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});

describe('DELETE /notifications/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('通知を削除すること', async () => {
    const existing = { id: 1, title: 'テスト通知' };
    mockPrisma.notification.findUnique.mockResolvedValue(existing);
    mockPrisma.notification.delete.mockResolvedValue(existing);

    const res = await app.handle(
      new Request('http://localhost/notifications/1', {
        method: 'DELETE',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.id).toBe(1);
  });

  test('存在しない通知で404を返すこと', async () => {
    mockPrisma.notification.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/notifications/999', {
        method: 'DELETE',
      }),
    );

    expect(res.status).toBe(404);
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/notifications/abc', {
        method: 'DELETE',
      }),
    );

    expect(res.status).toBe(400);
  });
});
