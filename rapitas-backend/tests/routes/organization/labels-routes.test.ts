/**
 * Labels Routes テスト
 * ラベルCRUD操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  label: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
  },
  taskLabel: {
    createMany: mock(() => Promise.resolve({ count: 0 })),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  task: {
    findUnique: mock(() => Promise.resolve(null)),
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

const { labelsRoutes } = await import('../../../routes/organization/labels');
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
    .use(labelsRoutes);
}

describe('GET /labels', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('全ラベルを返すこと', async () => {
    const labels = [
      { id: 1, name: 'Bug', color: '#FF0000', _count: { tasks: 3 } },
      { id: 2, name: 'Feature', color: '#00FF00', _count: { tasks: 5 } },
    ];
    mockPrisma.label.findMany.mockResolvedValue(labels);

    const res = await app.handle(new Request('http://localhost/labels'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0].name).toBe('Bug');
  });

  test('空配列を返すこと', async () => {
    mockPrisma.label.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/labels'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe('GET /labels/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('IDでラベルを取得すること', async () => {
    const label = {
      id: 1,
      name: 'Bug',
      color: '#FF0000',
      tasks: [],
    };
    mockPrisma.label.findUnique.mockResolvedValue(label);

    const res = await app.handle(new Request('http://localhost/labels/1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.name).toBe('Bug');
  });

  test('存在しないIDで404を返すこと', async () => {
    mockPrisma.label.findUnique.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/labels/999'));

    expect(res.status).toBe(404);
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/labels/abc'));

    expect(res.status).toBe(400);
  });
});

describe('POST /labels', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('ラベルを作成すること', async () => {
    const created = { id: 3, name: 'Urgent', color: '#FFA500' };
    mockPrisma.label.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request('http://localhost/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Urgent', color: '#FFA500' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Urgent');
    expect(mockPrisma.label.create).toHaveBeenCalledTimes(1);
  });

  test('名前なしでバリデーションエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe('PATCH /labels/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('ラベルを更新すること', async () => {
    const updated = { id: 1, name: 'Critical', color: '#FF0000' };
    mockPrisma.label.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/labels/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Critical' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Critical');
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/labels/abc', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      }),
    );

    expect(res.status).toBe(400);
  });
});

describe('DELETE /labels/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('ラベルを削除すること', async () => {
    const label = { id: 1, name: 'Bug' };
    mockPrisma.label.delete.mockResolvedValue(label);

    const res = await app.handle(new Request('http://localhost/labels/1', { method: 'DELETE' }));

    expect(res.status).toBe(200);
    expect(mockPrisma.label.delete).toHaveBeenCalledWith({
      where: { id: 1 },
    });
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/labels/abc', { method: 'DELETE' }));

    expect(res.status).toBe(400);
  });
});
