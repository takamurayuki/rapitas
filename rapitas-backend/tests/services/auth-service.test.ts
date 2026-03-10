/**
 * Auth Service テスト
 * 認証ルート（register, login, logout, me, sessions）のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

// --- mocks ---
const mockPrisma = {
  user: {
    findFirst: mock(() => Promise.resolve(null)),
    create: mock(() =>
      Promise.resolve({
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        passwordHash: '$2a$12$hashedpassword',
        role: 'user',
        googleId: null,
        lastLoginAt: null,
        createdAt: new Date('2026-03-01'),
      }),
    ),
    update: mock(() => Promise.resolve({})),
  },
  userSession: {
    create: mock(() =>
      Promise.resolve({
        id: 1,
        userId: 1,
        sessionToken: 'mock-token',
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
      }),
    ),
    findFirst: mock(() => Promise.resolve(null)),
    findMany: mock(() => Promise.resolve([])),
    deleteMany: mock(() => Promise.resolve({ count: 1 })),
  },
};

mock.module('../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

// Mock bcryptjs
mock.module('bcryptjs', () => ({
  default: {
    hash: mock(() => Promise.resolve('$2a$12$hashedpassword')),
    compare: mock(() => Promise.resolve(true)),
  },
}));

// Mock crypto
mock.module('crypto', () => ({
  randomBytes: () => ({
    toString: () => 'mock-session-token-hex-string-abcdef1234567890',
  }),
}));

// Mock googleapis
mock.module('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        generateAuthUrl() {
          return 'https://accounts.google.com/o/oauth2/auth?mock=true';
        }
        getToken() {
          return Promise.resolve({ tokens: {} });
        }
        setCredentials() {}
      },
    },
    oauth2: () => ({
      userinfo: {
        get: () =>
          Promise.resolve({
            data: { id: 'google-123', email: 'user@gmail.com', name: 'Test' },
          }),
      },
    }),
  },
}));

const { authRoutes } = await import('../../routes/system/auth');

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
  // Reset defaults
  mockPrisma.user.findFirst.mockResolvedValue(null);
  mockPrisma.user.create.mockResolvedValue({
    id: 1,
    username: 'testuser',
    email: 'test@example.com',
    passwordHash: '$2a$12$hashedpassword',
    role: 'user',
    googleId: null,
    lastLoginAt: null,
    createdAt: new Date('2026-03-01'),
  });
  mockPrisma.userSession.create.mockResolvedValue({
    id: 1,
    userId: 1,
    sessionToken: 'mock-token',
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
  });
  mockPrisma.userSession.findFirst.mockResolvedValue(null);
  mockPrisma.userSession.findMany.mockResolvedValue([]);
  mockPrisma.userSession.deleteMany.mockResolvedValue({ count: 1 });
}

function createApp() {
  return new Elysia().use(authRoutes);
}

describe('POST /auth/register', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('新規ユーザーを登録できること', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'newuser',
          email: 'newuser@example.com',
          password: 'securepassword123',
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.user).toBeDefined();
    expect(body.user.username).toBe('testuser');
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
  });

  test('既存のユーザー名で409を返すこと', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 1,
      username: 'existinguser',
      email: 'other@example.com',
    });

    const res = await app.handle(
      new Request('http://localhost/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'existinguser',
          email: 'new@example.com',
          password: 'securepassword123',
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.message).toContain('already exists');
  });

  test('パスワードが短すぎる場合バリデーションエラーになること', async () => {
    const res = await app.handle(
      new Request('http://localhost/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'newuser',
          email: 'new@example.com',
          password: 'short',
        }),
      }),
    );

    // Elysia validation should reject password < 8 chars
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('POST /auth/login', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('正しい認証情報でログインできること', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 1,
      username: 'testuser',
      email: 'test@example.com',
      passwordHash: '$2a$12$hashedpassword',
      role: 'user',
      lastLoginAt: null,
      createdAt: new Date('2026-03-01'),
    });

    const res = await app.handle(
      new Request('http://localhost/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'testuser',
          password: 'correctpassword',
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.token).toBeDefined();
    expect(body.user).toBeDefined();
    expect(body.user.username).toBe('testuser');
    expect(mockPrisma.userSession.create).toHaveBeenCalledTimes(1);
  });

  test('存在しないユーザーで401を返すこと', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'nonexistent',
          password: 'password123',
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Invalid credentials');
  });

  test('passwordHashがnullの場合401を返すこと', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 1,
      username: 'oauthuser',
      email: 'oauth@example.com',
      passwordHash: null,
      role: 'user',
    });

    const res = await app.handle(
      new Request('http://localhost/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'oauthuser',
          password: 'password123',
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.message).toBe('Invalid credentials');
  });
});

describe('POST /auth/logout', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('ログアウトが成功すること', async () => {
    const res = await app.handle(
      new Request('http://localhost/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'sessionToken=valid-token',
        },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Logged out successfully');
  });

  test('セッショントークンなしでもエラーにならないこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/auth/logout', {
        method: 'POST',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});

describe('GET /auth/me', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('セッショントークンなしで401を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/auth/me'));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });

  test('有効なセッションでユーザー情報を返すこと', async () => {
    mockPrisma.userSession.findFirst.mockResolvedValue({
      id: 1,
      sessionToken: 'valid-token',
      expiresAt: new Date(Date.now() + 86400000),
      user: {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        role: 'user',
        lastLoginAt: null,
      },
    });

    const res = await app.handle(
      new Request('http://localhost/auth/me', {
        headers: { Cookie: 'sessionToken=valid-token' },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.user.username).toBe('testuser');
    expect(body.user.email).toBe('test@example.com');
  });

  test('無効なセッションで401を返すこと', async () => {
    mockPrisma.userSession.findFirst.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/auth/me', {
        headers: { Cookie: 'sessionToken=expired-token' },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });
});

describe('GET /auth/google/url', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('Google OAuth URLを返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/auth/google/url'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.url).toBeDefined();
    expect(typeof body.url).toBe('string');
  });
});
