/**
 * Categories Routes テスト
 * カテゴリCRUD操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  category: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    findFirst: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
    count: mock(() => Promise.resolve(0)),
  },
  theme: {
    updateMany: mock(() => Promise.resolve({ count: 0 })),
  },
  userSettings: {
    findFirst: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({})),
    update: mock(() => Promise.resolve({})),
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

const { categoriesRoutes } = await import('../../../routes/organization/categories');
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
    .use(categoriesRoutes);
}

describe('GET /categories', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('全カテゴリを返すこと', async () => {
    const categories = [
      { id: 1, name: '開発', sortOrder: 0, themes: [], _count: { themes: 0 } },
      { id: 2, name: '学習', sortOrder: 1, themes: [], _count: { themes: 0 } },
    ];
    mockPrisma.category.findMany.mockResolvedValue(categories);

    const res = await app.handle(new Request('http://localhost/categories'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0].name).toBe('開発');
  });

  test('空配列を返すこと', async () => {
    mockPrisma.category.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/categories'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe('GET /categories/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('IDでカテゴリを取得すること', async () => {
    const category = {
      id: 1,
      name: '開発',
      description: '開発プロジェクト',
      themes: [],
    };
    mockPrisma.category.findUnique.mockResolvedValue(category);

    const res = await app.handle(new Request('http://localhost/categories/1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.name).toBe('開発');
  });

  test('存在しないIDで404を返すこと', async () => {
    mockPrisma.category.findUnique.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/categories/999'));

    expect(res.status).toBe(404);
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/categories/abc'));

    expect(res.status).toBe(400);
  });
});

describe('POST /categories', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('カテゴリを作成すること', async () => {
    const created = {
      id: 3,
      name: 'テスト',
      color: '#FF0000',
      _count: { themes: 0 },
    };
    mockPrisma.category.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request('http://localhost/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'テスト', color: '#FF0000' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('テスト');
    expect(mockPrisma.category.create).toHaveBeenCalledTimes(1);
  });

  test('名前なしでバリデーションエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe('PATCH /categories/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('カテゴリを更新すること', async () => {
    const existing = { id: 1, name: '旧名前' };
    const updated = {
      id: 1,
      name: '新名前',
      _count: { themes: 0 },
    };
    mockPrisma.category.findUnique.mockResolvedValue(existing);
    mockPrisma.category.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/categories/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '新名前' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('新名前');
  });

  test('存在しないIDで404を返すこと', async () => {
    mockPrisma.category.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/categories/999', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '新名前' }),
      }),
    );

    expect(res.status).toBe(404);
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/categories/abc', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '新名前' }),
      }),
    );

    expect(res.status).toBe(400);
  });
});

describe('DELETE /categories/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('カテゴリを削除すること', async () => {
    const category = { id: 1, name: '削除対象', isDefault: false };
    mockPrisma.category.findUnique.mockResolvedValue(category);
    mockPrisma.category.delete.mockResolvedValue(category);

    const res = await app.handle(
      new Request('http://localhost/categories/1', { method: 'DELETE' }),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.category.delete).toHaveBeenCalledWith({
      where: { id: 1 },
    });
  });

  test('デフォルトカテゴリの削除で400を返すこと', async () => {
    const category = { id: 1, name: '開発', isDefault: true };
    mockPrisma.category.findUnique.mockResolvedValue(category);

    const res = await app.handle(
      new Request('http://localhost/categories/1', { method: 'DELETE' }),
    );

    expect(res.status).toBe(400);
  });

  test('存在しないIDで404を返すこと', async () => {
    mockPrisma.category.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/categories/999', { method: 'DELETE' }),
    );

    expect(res.status).toBe(404);
  });

  test('無効なIDで400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/categories/abc', { method: 'DELETE' }),
    );

    expect(res.status).toBe(400);
  });
});
