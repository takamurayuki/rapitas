/**
 * Flashcards Routes テスト
 * フラッシュカードCRUD操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  flashcardDeck: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    delete: mock(() => Promise.resolve({})),
  },
  flashcard: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
  },
  userSettings: {
    findFirst: mock(() => Promise.resolve(null)),
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
mock.module('../../../utils/encryption', () => ({
  encrypt: (value: string) => `encrypted_${value}`,
  decrypt: (value: string) => value.replace('encrypted_', ''),
  maskApiKey: (value: string) => `${value.slice(0, 4)}****`,
  isEncryptionKeyConfigured: () => true,
}));

const { flashcardsRoutes } = await import('../../../routes/learning/flashcards');

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
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: 'Validation error' };
      }
      set.status = 500;
      return {
        error: error instanceof Error ? error.message : 'Server error',
      };
    })
    .use(flashcardsRoutes);
}

describe('GET /flashcard-decks', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('全デッキを返すこと', async () => {
    const decks = [
      { id: 1, name: 'JavaScript基礎', _count: { cards: 10 } },
      { id: 2, name: 'TypeScript応用', _count: { cards: 5 } },
    ];
    mockPrisma.flashcardDeck.findMany.mockResolvedValue(decks);

    const res = await app.handle(new Request('http://localhost/flashcard-decks'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0].name).toBe('JavaScript基礎');
  });

  test('空配列を返すこと', async () => {
    mockPrisma.flashcardDeck.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/flashcard-decks'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe('GET /flashcard-decks/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('IDでデッキを取得すること', async () => {
    const deck = {
      id: 1,
      name: 'JavaScript基礎',
      cards: [{ id: 1, front: 'varとletの違いは？', back: 'スコープの違い' }],
    };
    mockPrisma.flashcardDeck.findUnique.mockResolvedValue(deck);

    const res = await app.handle(new Request('http://localhost/flashcard-decks/1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.name).toBe('JavaScript基礎');
    expect(body.cards.length).toBe(1);
  });

  test('存在しないIDでnullを返すこと', async () => {
    mockPrisma.flashcardDeck.findUnique.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/flashcard-decks/999'));

    // Route returns null which results in 200 with empty body
    expect(res.status).toBe(200);
  });
});

describe('POST /flashcard-decks', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('デッキを作成すること', async () => {
    const created = { id: 1, name: '新規デッキ' };
    mockPrisma.flashcardDeck.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request('http://localhost/flashcard-decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '新規デッキ' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('新規デッキ');
    expect(mockPrisma.flashcardDeck.create).toHaveBeenCalledTimes(1);
  });

  test('名前なしでバリデーションエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/flashcard-decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe('DELETE /flashcard-decks/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('デッキを削除すること', async () => {
    const deck = { id: 1, name: '削除対象' };
    mockPrisma.flashcardDeck.delete.mockResolvedValue(deck);

    const res = await app.handle(
      new Request('http://localhost/flashcard-decks/1', { method: 'DELETE' }),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.flashcardDeck.delete).toHaveBeenCalledWith({
      where: { id: 1 },
    });
  });
});
