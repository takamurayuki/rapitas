/**
 * GitHub Routes テスト
 * GitHub統合APIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  gitHubIntegration: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
  },
  gitHubPullRequest: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    update: mock(() => Promise.resolve({})),
  },
  gitHubIssue: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
  },
  gitHubPRComment: {
    create: mock(() => Promise.resolve({ id: 1 })),
  },
  notification: {
    create: mock(() => Promise.resolve({ id: 1 })),
  },
  task: {
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1, title: "Task" })),
    update: mock(() => Promise.resolve({})),
  },
};

const mockIsGhAvailable = mock(() => Promise.resolve(true));
const mockIsAuthenticated = mock(() => Promise.resolve(true));
const mockSyncPullRequests = mock(() => Promise.resolve(5));
const mockSyncIssues = mock(() => Promise.resolve(3));
const mockGetPullRequests = mock(() => Promise.resolve([]));
const mockGetPullRequestDiff = mock(() => Promise.resolve({ diff: "" }));
const mockCreatePullRequestComment = mock(() => Promise.resolve({ id: 1 }));
const mockApprovePullRequest = mock(() => Promise.resolve());
const mockRequestChanges = mock(() => Promise.resolve());
const mockGetIssues = mock(() => Promise.resolve([]));
const mockAddIssueComment = mock(() => Promise.resolve({ id: 1 }));
const mockCreateIssue = mock(() =>
  Promise.resolve({
    number: 1,
    title: "Test",
    body: "",
    state: "open",
    labels: [],
    authorLogin: "test",
    url: "https://github.com/test/repo/issues/1",
  })
);
const mockHandleWebhook = mock(() => Promise.resolve());

class MockGitHubService {
  isGhAvailable = mockIsGhAvailable;
  isAuthenticated = mockIsAuthenticated;
  syncPullRequests = mockSyncPullRequests;
  syncIssues = mockSyncIssues;
  getPullRequests = mockGetPullRequests;
  getPullRequestDiff = mockGetPullRequestDiff;
  createPullRequestComment = mockCreatePullRequestComment;
  approvePullRequest = mockApprovePullRequest;
  requestChanges = mockRequestChanges;
  getIssues = mockGetIssues;
  addIssueComment = mockAddIssueComment;
  createIssue = mockCreateIssue;
  handleWebhook = mockHandleWebhook;
}

mock.module("../../../config/database", () => ({ prisma: mockPrisma }));
mock.module("../../../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));
mock.module("../../../services/github-service", () => ({
  GitHubService: MockGitHubService,
}));
// Re-export the real schemas - they use elysia's t() which needs to be real
// No mock needed for schemas as they are just type definitions

const { githubRoutes, taskGithubRoutes } = await import(
  "../../../routes/social/github"
);

function resetAllMocks() {
  for (const model of Object.values(mockPrisma)) {
    if (typeof model === "object" && model !== null) {
      for (const method of Object.values(model)) {
        if (typeof method === "function" && "mockReset" in method) {
          (method as ReturnType<typeof mock>).mockReset();
        }
      }
    }
  }
  mockIsGhAvailable.mockReset();
  mockIsAuthenticated.mockReset();
  mockSyncPullRequests.mockReset();
  mockSyncIssues.mockReset();
  mockGetPullRequests.mockReset();
  mockGetPullRequestDiff.mockReset();
  mockCreatePullRequestComment.mockReset();
  mockApprovePullRequest.mockReset();
  mockRequestChanges.mockReset();
  mockGetIssues.mockReset();
  mockAddIssueComment.mockReset();
  mockCreateIssue.mockReset();
  mockHandleWebhook.mockReset();

  mockIsGhAvailable.mockResolvedValue(true);
  mockIsAuthenticated.mockResolvedValue(true);
  mockSyncPullRequests.mockResolvedValue(5);
  mockSyncIssues.mockResolvedValue(3);
  mockGetPullRequests.mockResolvedValue([]);
  mockGetIssues.mockResolvedValue([]);
}

function createApp() {
  return new Elysia().use(githubRoutes);
}

function createTaskApp() {
  return new Elysia().use(taskGithubRoutes);
}

describe("GET /github/status", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("GitHub CLIステータスを返すこと", async () => {
    mockIsGhAvailable.mockResolvedValue(true);
    mockIsAuthenticated.mockResolvedValue(true);

    const res = await app.handle(
      new Request("http://localhost/github/status"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ghAvailable).toBe(true);
    expect(body.authenticated).toBe(true);
  });

  test("GitHub CLI未インストール時のステータスを返すこと", async () => {
    mockIsGhAvailable.mockResolvedValue(false);

    const res = await app.handle(
      new Request("http://localhost/github/status"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ghAvailable).toBe(false);
    expect(body.authenticated).toBe(false);
  });
});

describe("GET /github/integrations", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("統合一覧を返すこと", async () => {
    const integrations = [
      {
        id: 1,
        repositoryUrl: "https://github.com/test/repo",
        ownerName: "test",
        repositoryName: "repo",
        _count: { pullRequests: 5, issues: 3 },
      },
    ];
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue(integrations);

    const res = await app.handle(
      new Request("http://localhost/github/integrations"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
  });

  test("空配列を返すこと", async () => {
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/github/integrations"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe("POST /github/integrations", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("統合を作成すること", async () => {
    const created = {
      id: 1,
      repositoryUrl: "https://github.com/test/repo",
      ownerName: "test",
      repositoryName: "repo",
      syncIssues: true,
      syncPullRequests: true,
      autoLinkTasks: true,
    };
    mockPrisma.gitHubIntegration.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request("http://localhost/github/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositoryUrl: "https://github.com/test/repo",
          ownerName: "test",
          repositoryName: "repo",
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.repositoryUrl).toBe("https://github.com/test/repo");
  });
});

describe("GET /github/integrations/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("統合詳細を返すこと", async () => {
    const integration = {
      id: 1,
      repositoryUrl: "https://github.com/test/repo",
      ownerName: "test",
      repositoryName: "repo",
      _count: { pullRequests: 5, issues: 3 },
    };
    mockPrisma.gitHubIntegration.findUnique.mockResolvedValue(integration);

    const res = await app.handle(
      new Request("http://localhost/github/integrations/1"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
  });
});

describe("PATCH /github/integrations/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("統合を更新すること", async () => {
    const updated = { id: 1, syncIssues: false, isActive: true };
    mockPrisma.gitHubIntegration.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request("http://localhost/github/integrations/1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncIssues: false }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.syncIssues).toBe(false);
  });
});

describe("DELETE /github/integrations/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("統合を削除すること", async () => {
    const deleted = { id: 1 };
    mockPrisma.gitHubIntegration.delete.mockResolvedValue(deleted);

    const res = await app.handle(
      new Request("http://localhost/github/integrations/1", {
        method: "DELETE",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
  });
});

describe("POST /github/integrations/:id/sync-prs", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("PRを同期すること", async () => {
    mockSyncPullRequests.mockResolvedValue(5);

    const res = await app.handle(
      new Request("http://localhost/github/integrations/1/sync-prs", {
        method: "POST",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.syncedCount).toBe(5);
  });
});

describe("POST /github/integrations/:id/sync-issues", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("Issueを同期すること", async () => {
    mockSyncIssues.mockResolvedValue(3);

    const res = await app.handle(
      new Request("http://localhost/github/integrations/1/sync-issues", {
        method: "POST",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.syncedCount).toBe(3);
  });
});

describe("GET /github/integrations/:id/pull-requests", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("DBからPR一覧を返すこと", async () => {
    const prs = [
      { id: 1, prNumber: 42, title: "Feature PR", state: "open", _count: { reviews: 0, comments: 1 } },
    ];
    mockPrisma.gitHubPullRequest.findMany.mockResolvedValue(prs);

    const res = await app.handle(
      new Request("http://localhost/github/integrations/1/pull-requests"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test("GitHubからPR一覧を取得すること", async () => {
    const integration = { id: 1, ownerName: "test", repositoryName: "repo" };
    mockPrisma.gitHubIntegration.findUnique.mockResolvedValue(integration);
    mockGetPullRequests.mockResolvedValue([{ number: 1, title: "PR" }]);

    const res = await app.handle(
      new Request(
        "http://localhost/github/integrations/1/pull-requests?fromGitHub=true",
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

describe("GET /github/pull-requests/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("PR詳細を返すこと", async () => {
    const pr = {
      id: 1,
      prNumber: 42,
      title: "Feature PR",
      integration: { ownerName: "test", repositoryName: "repo" },
      reviews: [],
      comments: [],
    };
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(pr);

    const res = await app.handle(
      new Request("http://localhost/github/pull-requests/1"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.prNumber).toBe(42);
  });
});

describe("GET /github/pull-requests/:id/diff", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("PR差分を返すこと", async () => {
    const pr = {
      id: 1,
      prNumber: 42,
      integration: { ownerName: "test", repositoryName: "repo" },
    };
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(pr);
    mockGetPullRequestDiff.mockResolvedValue({ diff: "diff content" });

    const res = await app.handle(
      new Request("http://localhost/github/pull-requests/1/diff"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.diff).toBe("diff content");
  });

  test("PRが見つからない場合エラーを返すこと", async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/github/pull-requests/999/diff"),
    );
    const body = await res.json();

    expect(body.error).toBeDefined();
  });
});

describe("GET /github/integrations/:id/issues", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("DBからIssue一覧を返すこと", async () => {
    const issues = [
      { id: 1, issueNumber: 10, title: "Bug", state: "open" },
    ];
    mockPrisma.gitHubIssue.findMany.mockResolvedValue(issues);

    const res = await app.handle(
      new Request("http://localhost/github/integrations/1/issues"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

describe("GET /github/issues/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("Issue詳細を返すこと", async () => {
    const issue = {
      id: 1,
      issueNumber: 10,
      title: "Bug",
      integration: { ownerName: "test", repositoryName: "repo" },
    };
    mockPrisma.gitHubIssue.findUnique.mockResolvedValue(issue);

    const res = await app.handle(
      new Request("http://localhost/github/issues/1"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.issueNumber).toBe(10);
  });
});

describe("POST /github/webhook", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("Webhookを処理すること", async () => {
    mockHandleWebhook.mockResolvedValue(undefined);

    const res = await app.handle(
      new Request("http://localhost/github/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-event": "push",
        },
        body: JSON.stringify({ action: "opened" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("x-github-eventヘッダーなしでエラーを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/github/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "opened" }),
      }),
    );
    const body = await res.json();

    expect(body.error).toBeDefined();
  });
});

describe("POST /tasks/:id/create-github-issue (taskGithubRoutes)", () => {
  let app: ReturnType<typeof createTaskApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createTaskApp();
  });

  test("タスクからGitHub Issueを作成すること", async () => {
    const task = { id: 1, title: "Test Task", description: "description" };
    const integration = { id: 1, ownerName: "test", repositoryName: "repo" };
    mockPrisma.task.findUnique.mockResolvedValue(task);
    mockPrisma.gitHubIntegration.findUnique.mockResolvedValue(integration);
    mockCreateIssue.mockResolvedValue({
      number: 42,
      title: "Test Task",
      body: "description",
      state: "open",
      labels: [],
      authorLogin: "test",
      url: "https://github.com/test/repo/issues/42",
    });
    mockPrisma.gitHubIssue.create.mockResolvedValue({ id: 1 });
    mockPrisma.task.update.mockResolvedValue({});

    const res = await app.handle(
      new Request("http://localhost/tasks/1/create-github-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationId: 1 }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
  });

  test("タスクが見つからない場合エラーを返すこと", async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/tasks/999/create-github-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationId: 1 }),
      }),
    );
    const body = await res.json();

    expect(body.error).toBeDefined();
  });
});
