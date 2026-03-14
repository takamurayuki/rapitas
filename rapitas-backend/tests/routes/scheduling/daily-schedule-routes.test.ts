/**
 * Daily Schedule Routes テスト
 * 一日のスケジュールブロックAPIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  dailyScheduleBlock: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({ id: 1 })),
    delete: mock(() => Promise.resolve({ id: 1 })),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  $transaction: mock((ops: unknown[]) => Promise.resolve(ops)),
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

const { dailyScheduleRoutes } = await import('../../../routes/scheduling/daily-schedule');

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
  if (typeof mockPrisma.$transaction === 'function' && 'mockReset' in mockPrisma.$transaction) {
    mockPrisma.$transaction.mockReset();
    mockPrisma.$transaction.mockResolvedValue([]);
  }
  mockPrisma.dailyScheduleBlock.findMany.mockResolvedValue([]);
}

function createApp() {
  return new Elysia().use(dailyScheduleRoutes);
}

describe('GET /daily-schedule/', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('全ブロックを返すこと', async () => {
    const blocks = [
      { id: 1, label: 'Morning Study', startTime: '06:00', endTime: '08:00', sortOrder: 0 },
      { id: 2, label: 'Work', startTime: '09:00', endTime: '17:00', sortOrder: 1 },
    ];
    mockPrisma.dailyScheduleBlock.findMany.mockResolvedValue(blocks);

    const res = await app.handle(new Request('http://localhost/daily-schedule/'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
  });

  test('空の配列を返すこと', async () => {
    mockPrisma.dailyScheduleBlock.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/daily-schedule/'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe('POST /daily-schedule/', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('新しいブロックを作成できること', async () => {
    const created = {
      id: 1,
      label: 'Study',
      startTime: '06:00',
      endTime: '08:00',
      color: '#3B82F6',
    };
    mockPrisma.dailyScheduleBlock.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request('http://localhost/daily-schedule/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Study',
          startTime: '06:00',
          endTime: '08:00',
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.label).toBe('Study');
    expect(mockPrisma.dailyScheduleBlock.create).toHaveBeenCalledTimes(1);
  });

  test('labelなしでバリデーションエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/daily-schedule/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: '',
          startTime: '06:00',
          endTime: '08:00',
        }),
      }),
    );

    expect(res.status).toBe(422);
  });

  test('必須フィールドなしでバリデーションエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/daily-schedule/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Study' }),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe('PATCH /daily-schedule/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('ブロックを更新できること', async () => {
    const updated = { id: 1, label: 'Updated Study', startTime: '07:00', endTime: '09:00' };
    mockPrisma.dailyScheduleBlock.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/daily-schedule/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Updated Study' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.label).toBe('Updated Study');
  });

  test('部分更新ができること', async () => {
    const updated = {
      id: 1,
      label: 'Study',
      startTime: '06:00',
      endTime: '08:00',
      color: '#FF0000',
    };
    mockPrisma.dailyScheduleBlock.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/daily-schedule/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color: '#FF0000' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.color).toBe('#FF0000');
  });
});

describe('DELETE /daily-schedule/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('ブロックを削除できること', async () => {
    mockPrisma.dailyScheduleBlock.delete.mockResolvedValue({ id: 1, label: 'Deleted' });

    const res = await app.handle(
      new Request('http://localhost/daily-schedule/1', { method: 'DELETE' }),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.dailyScheduleBlock.delete).toHaveBeenCalledTimes(1);
  });

  test('Prismaエラー時にエラーを返すこと', async () => {
    mockPrisma.dailyScheduleBlock.delete.mockRejectedValue(new Error('Record not found'));

    const res = await app.handle(
      new Request('http://localhost/daily-schedule/999', { method: 'DELETE' }),
    );

    expect(res.status).toBe(500);
  });
});
