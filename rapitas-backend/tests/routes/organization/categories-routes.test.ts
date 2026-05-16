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

describe('POST /categories/seed-defaults', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('既存カテゴリが無いときデフォルトを新規作成すること', async () => {
    mockPrisma.category.findMany.mockResolvedValue([]);
    mockPrisma.category.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 99, ...data, _count: { themes: 0 } }),
    );

    const res = await app.handle(
      new Request('http://localhost/categories/seed-defaults', { method: 'POST' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(mockPrisma.category.create).toHaveBeenCalledTimes(2);
    const firstCall = mockPrisma.category.create.mock.calls[0][0];
    expect(firstCall.data.name).toBe('開発');
    expect(firstCall.data.icon).toBe('Code');
    expect(firstCall.data.isDefault).toBe(true);
  });

  test('既存カテゴリの icon/description が null のとき DEFAULT 値で補完すること', async () => {
    mockPrisma.category.findMany.mockImplementation(({ where }: { where: { name: string } }) => {
      if (where.name === '開発') {
        return Promise.resolve([
          {
            id: 10,
            name: '開発',
            icon: null,
            description: null,
            color: '#6366F1',
            mode: 'development',
            sortOrder: 0,
            isDefault: false,
            _count: { themes: 0 },
          },
        ]);
      }
      return Promise.resolve([
        {
          id: 11,
          name: '学習',
          icon: 'BookOpen',
          description: '学習に関するテーマ',
          color: '#10B981',
          mode: 'learning',
          sortOrder: 1,
          isDefault: true,
          _count: { themes: 0 },
        },
      ]);
    });
    mockPrisma.category.update.mockImplementation(
      ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) =>
        Promise.resolve({ id: where.id, ...data, _count: { themes: 0 } }),
    );

    const res = await app.handle(
      new Request('http://localhost/categories/seed-defaults', { method: 'POST' }),
    );

    expect(res.status).toBe(200);
    // Only the 開発 row needs to be patched; 学習 is fully populated.
    expect(mockPrisma.category.update).toHaveBeenCalledTimes(1);
    const updateCall = mockPrisma.category.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 10 });
    expect(updateCall.data.icon).toBe('Code');
    expect(updateCall.data.description).toBe('開発プロジェクトに関するテーマ');
    expect(updateCall.data.color).toBe('#3B82F6');
    expect(updateCall.data.isDefault).toBe(true);
  });

  test('ユーザーがカスタマイズした icon/color は上書きしないこと', async () => {
    mockPrisma.category.findMany.mockImplementation(({ where }: { where: { name: string } }) => {
      const base =
        where.name === '開発'
          ? {
              id: 20,
              name: '開発',
              icon: 'Star',
              description: 'カスタム説明',
              color: '#ABCDEF',
              mode: 'development',
              sortOrder: 0,
              isDefault: true,
              _count: { themes: 0 },
            }
          : {
              id: 21,
              name: '学習',
              icon: 'Heart',
              description: 'カスタム学習',
              color: '#FEDCBA',
              mode: 'learning',
              sortOrder: 1,
              isDefault: true,
              _count: { themes: 0 },
            };
      return Promise.resolve([base]);
    });

    const res = await app.handle(
      new Request('http://localhost/categories/seed-defaults', { method: 'POST' }),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.category.update).not.toHaveBeenCalled();
  });

  test('mode のみ差分がある場合は mode だけ更新すること', async () => {
    mockPrisma.category.findMany.mockImplementation(({ where }: { where: { name: string } }) => {
      if (where.name === '開発') {
        return Promise.resolve([
          {
            id: 30,
            name: '開発',
            icon: 'Code',
            description: '開発プロジェクトに関するテーマ',
            color: '#3B82F6',
            mode: 'both',
            sortOrder: 0,
            isDefault: true,
            _count: { themes: 0 },
          },
        ]);
      }
      return Promise.resolve([
        {
          id: 31,
          name: '学習',
          icon: 'BookOpen',
          description: '学習に関するテーマ',
          color: '#10B981',
          mode: 'learning',
          sortOrder: 1,
          isDefault: true,
          _count: { themes: 0 },
        },
      ]);
    });
    mockPrisma.category.update.mockImplementation(
      ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) =>
        Promise.resolve({ id: where.id, ...data, _count: { themes: 0 } }),
    );

    const res = await app.handle(
      new Request('http://localhost/categories/seed-defaults', { method: 'POST' }),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.category.update).toHaveBeenCalledTimes(1);
    const updateCall = mockPrisma.category.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 30 });
    expect(updateCall.data).toEqual({ mode: 'development' });
  });

  test('同名の重複カテゴリを統合してテーマを reassign すること', async () => {
    mockPrisma.category.findMany.mockImplementation(({ where }: { where: { name: string } }) => {
      if (where.name === '開発') {
        return Promise.resolve([
          {
            id: 40,
            name: '開発',
            icon: 'Code',
            description: '開発プロジェクトに関するテーマ',
            color: '#3B82F6',
            mode: 'development',
            sortOrder: 0,
            isDefault: true,
            _count: { themes: 0 },
          },
          {
            id: 41,
            name: '開発',
            icon: null,
            description: null,
            color: '#6366F1',
            mode: 'both',
            sortOrder: 0,
            isDefault: false,
            _count: { themes: 0 },
          },
        ]);
      }
      return Promise.resolve([
        {
          id: 42,
          name: '学習',
          icon: 'BookOpen',
          description: '学習に関するテーマ',
          color: '#10B981',
          mode: 'learning',
          sortOrder: 1,
          isDefault: true,
          _count: { themes: 0 },
        },
      ]);
    });

    const res = await app.handle(
      new Request('http://localhost/categories/seed-defaults', { method: 'POST' }),
    );

    expect(res.status).toBe(200);
    // duplicates: themes reassigned then duplicate category deleted
    expect(mockPrisma.theme.updateMany).toHaveBeenCalledWith({
      where: { categoryId: 41 },
      data: { categoryId: 40 },
    });
    expect(mockPrisma.category.delete).toHaveBeenCalledWith({ where: { id: 41 } });
  });
});
