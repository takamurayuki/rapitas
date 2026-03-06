/**
 * Auth Routes テスト
 * 認証機能（登録・ログイン・ログアウト・セッション管理）のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  user: {
    findFirst: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
  },
  userSession: {
    findFirst: mock(() => Promise.resolve(null)),
    findMany: mock(() => Promise.resolve([])),
    create: mock(() => Promise.resolve({})),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
};

const mockBcrypt = {
  hash: mock(() => Promise.resolve("$2a$12$hashed")),
  compare: mock(() => Promise.resolve(true)),
};

mock.module("../../../config/database", () => ({ prisma: mockPrisma }));
mock.module("bcryptjs", () => ({ default: mockBcrypt }));
mock.module("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class MockOAuth2 {
        generateAuthUrl() {
          return "https://accounts.google.com/o/oauth2/v2/auth";
        }
        getToken() {
          return Promise.resolve({ tokens: {} });
        }
        setCredentials() {}
      },
    },
    oauth2: () => ({
      userinfo: {
        get: () => Promise.resolve({ data: {} }),
      },
    }),
  },
}));
mock.module("../../../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { authRoutes } = await import("../../../routes/system/auth");

function resetAllMocks() {
  for (const model of Object.values(mockPrisma)) {
    for (const method of Object.values(model)) {
      if (typeof method === "function" && "mockReset" in method) {
        (method as ReturnType<typeof mock>).mockReset();
      }
    }
  }
  mockBcrypt.hash.mockReset();
  mockBcrypt.compare.mockReset();
  mockBcrypt.hash.mockResolvedValue("$2a$12$hashed");
  mockBcrypt.compare.mockResolvedValue(true);
}

function createApp() {
  return new Elysia().use(authRoutes);
}

const now = new Date("2026-03-05T10:00:00.000Z");

describe("POST /auth/register", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("新規ユーザーを登録すること", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 1,
      username: "testuser",
      email: "test@example.com",
      role: "user",
      createdAt: now,
      lastLoginAt: null,
    });
    mockPrisma.userSession.create.mockResolvedValue({});

    const res = await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "testuser",
          email: "test@example.com",
          password: "password123",
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.user.username).toBe("testuser");
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.userSession.create).toHaveBeenCalledTimes(1);
  });

  test("既存ユーザー名で409を返すこと", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 1,
      username: "testuser",
      email: "other@example.com",
    });

    const res = await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "testuser",
          email: "new@example.com",
          password: "password123",
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.message).toContain("Username");
  });

  test("既存メールで409を返すこと", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 1,
      username: "otheruser",
      email: "test@example.com",
    });

    const res = await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "newuser",
          email: "test@example.com",
          password: "password123",
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.message).toContain("Email");
  });

  test("短すぎるパスワードでバリデーションエラーを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "testuser",
          email: "test@example.com",
          password: "short",
        }),
      }),
    );
    expect(res.status).toBe(422);
  });
});

describe("POST /auth/login", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("正常にログインすること", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 1,
      username: "testuser",
      email: "test@example.com",
      passwordHash: "$2a$12$hashed",
      role: "user",
      createdAt: now,
      lastLoginAt: null,
    });
    mockBcrypt.compare.mockResolvedValue(true);
    mockPrisma.userSession.create.mockResolvedValue({});
    mockPrisma.user.update.mockResolvedValue({});

    const res = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "testuser",
          password: "password123",
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.token).toBeDefined();
    expect(body.user.username).toBe("testuser");
    expect(mockPrisma.userSession.create).toHaveBeenCalledTimes(1);
  });

  test("存在しないユーザーで401を返すこと", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "nonexistent",
          password: "password123",
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.message).toBe("Invalid credentials");
  });

  test("パスワード不一致で401を返すこと", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 1,
      username: "testuser",
      passwordHash: "$2a$12$hashed",
    });
    mockBcrypt.compare.mockResolvedValue(false);

    const res = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "testuser",
          password: "wrongpassword",
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });

  test("passwordHashがnullのユーザー(OAuth)で401を返すこと", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 1,
      username: "oauthuser",
      passwordHash: null,
    });

    const res = await app.handle(
      new Request("http://localhost/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "oauthuser",
          password: "password123",
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });
});

describe("POST /auth/logout", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("正常にログアウトすること", async () => {
    mockPrisma.userSession.deleteMany.mockResolvedValue({ count: 1 });

    const res = await app.handle(
      new Request("http://localhost/auth/logout", {
        method: "POST",
        headers: {
          Cookie: "sessionToken=test-token-123",
        },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("トークンなしでも正常応答すること", async () => {
    const res = await app.handle(
      new Request("http://localhost/auth/logout", {
        method: "POST",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});

describe("GET /auth/me", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("有効なセッションでユーザー情報を返すこと", async () => {
    mockPrisma.userSession.findFirst.mockResolvedValue({
      sessionToken: "valid-token",
      expiresAt: new Date(Date.now() + 86400000),
      user: {
        id: 1,
        username: "testuser",
        email: "test@example.com",
        role: "user",
        lastLoginAt: now,
      },
    });

    const res = await app.handle(
      new Request("http://localhost/auth/me", {
        headers: { Cookie: "sessionToken=valid-token" },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.user.username).toBe("testuser");
  });

  test("トークンなしで401を返すこと", async () => {
    const res = await app.handle(new Request("http://localhost/auth/me"));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });

  test("無効/期限切れセッションで401を返すこと", async () => {
    mockPrisma.userSession.findFirst.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/auth/me", {
        headers: { Cookie: "sessionToken=expired-token" },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });
});

describe("GET /auth/sessions", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("セッション一覧を返すこと", async () => {
    mockPrisma.userSession.findFirst.mockResolvedValue({
      sessionToken: "current-token",
      expiresAt: new Date(Date.now() + 86400000),
      user: { id: 1 },
    });
    mockPrisma.userSession.findMany.mockResolvedValue([
      {
        id: 1,
        sessionToken: "current-token",
        createdAt: now,
        expiresAt: new Date(Date.now() + 86400000),
      },
      {
        id: 2,
        sessionToken: "other-token",
        createdAt: now,
        expiresAt: new Date(Date.now() + 86400000),
      },
    ]);

    const res = await app.handle(
      new Request("http://localhost/auth/sessions", {
        headers: { Cookie: "sessionToken=current-token" },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.sessions.length).toBe(2);
    expect(body.sessions[0].isCurrentSession).toBe(true);
    expect(body.sessions[1].isCurrentSession).toBe(false);
  });

  test("トークンなしで401を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/auth/sessions"),
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });
});

describe("DELETE /auth/sessions/:sessionId", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("セッションを削除すること", async () => {
    mockPrisma.userSession.findFirst.mockResolvedValue({
      sessionToken: "current-token",
      expiresAt: new Date(Date.now() + 86400000),
      user: { id: 1 },
    });
    mockPrisma.userSession.deleteMany.mockResolvedValue({ count: 1 });

    const res = await app.handle(
      new Request("http://localhost/auth/sessions/2", {
        method: "DELETE",
        headers: { Cookie: "sessionToken=current-token" },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("存在しないセッションで404を返すこと", async () => {
    mockPrisma.userSession.findFirst.mockResolvedValue({
      sessionToken: "current-token",
      expiresAt: new Date(Date.now() + 86400000),
      user: { id: 1 },
    });
    mockPrisma.userSession.deleteMany.mockResolvedValue({ count: 0 });

    const res = await app.handle(
      new Request("http://localhost/auth/sessions/999", {
        method: "DELETE",
        headers: { Cookie: "sessionToken=current-token" },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
  });

  test("無効なセッションIDで400を返すこと", async () => {
    mockPrisma.userSession.findFirst.mockResolvedValue({
      sessionToken: "current-token",
      expiresAt: new Date(Date.now() + 86400000),
      user: { id: 1 },
    });

    const res = await app.handle(
      new Request("http://localhost/auth/sessions/abc", {
        method: "DELETE",
        headers: { Cookie: "sessionToken=current-token" },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });
});

describe("POST /auth/cleanup-sessions", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("admin権限で期限切れセッションを削除すること", async () => {
    mockPrisma.userSession.findFirst.mockResolvedValue({
      sessionToken: "admin-token",
      expiresAt: new Date(Date.now() + 86400000),
      user: { id: 1, role: "admin" },
    });
    mockPrisma.userSession.deleteMany.mockResolvedValue({ count: 5 });

    const res = await app.handle(
      new Request("http://localhost/auth/cleanup-sessions", {
        method: "POST",
        headers: { Cookie: "sessionToken=admin-token" },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain("5");
  });

  test("非admin権限で403を返すこと", async () => {
    mockPrisma.userSession.findFirst.mockResolvedValue({
      sessionToken: "user-token",
      expiresAt: new Date(Date.now() + 86400000),
      user: { id: 2, role: "user" },
    });

    const res = await app.handle(
      new Request("http://localhost/auth/cleanup-sessions", {
        method: "POST",
        headers: { Cookie: "sessionToken=user-token" },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
  });

  test("トークンなしで401を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/auth/cleanup-sessions", {
        method: "POST",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });
});
