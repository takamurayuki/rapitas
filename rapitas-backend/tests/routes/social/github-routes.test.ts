/**
 * GitHub Routes テスト
 * GitHub統合APIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import { errorHandler } from '../../../middleware/error-handler';

// HACK(agent): Bun mock型推論の制限 — 型パラメーターをサポートしていないため `as any` で型チェックをバイパス
const mockPrisma = {
  gitHubIntegration: {
    findMany: mock(() => Promise.resolve([])) as any,
    findUnique: mock(() => Promise.resolve(null)) as any,
    create: mock(() => Promise.resolve({ id: 1 })) as any,
    update: mock(() => Promise.resolve({})) as any,
    delete: mock(() => Promise.resolve({})) as any,
  },
  gitHubPullRequest: {
    findMany: mock(() => Promise.resolve([])) as any,
    findFirst: mock(() => Promise.resolve(null)) as any,
    findUnique: mock(() => Promise.resolve(null)) as any,
    update: mock(() => Promise.resolve({})) as any,
  },
  gitHubIssue: {
    findMany: mock(() => Promise.resolve([])) as any,
    findUnique: mock(() => Promise.resolve(null)) as any,
    create: mock(() => Promise.resolve({ id: 1 })) as any,
    update: mock(() => Promise.resolve({})) as any,
  },
  gitHubPRComment: {
    create: mock(() => Promise.resolve({ id: 1 })) as any,
  },
  notification: {
    create: mock(() => Promise.resolve({ id: 1 })) as any,
  },
  task: {
    findUnique: mock(() => Promise.resolve(null)) as any,
    create: mock(() => Promise.resolve({ id: 1, title: 'Task' })) as any,
    update: mock(() => Promise.resolve({})) as any,
  },
  activityLog: {
    findFirst: mock(() => Promise.resolve(null)) as any,
  },
};

// HACK(agent): Bun mock型推論の制限
const mockIsGhAvailable = mock(() => Promise.resolve(true)) as any;
const mockIsAuthenticated = mock(() => Promise.resolve(true)) as any;
const mockSyncPullRequests = mock(() => Promise.resolve(5)) as any;
const mockSyncIssues = mock(() => Promise.resolve(3)) as any;
const mockGetPullRequests = mock(() => Promise.resolve([])) as any;
const mockGetPullRequestDiff = mock(() => Promise.resolve({ diff: '' })) as any;
const mockCreatePullRequestComment = mock(() => Promise.resolve({ id: 1 })) as any;
const mockApprovePullRequest = mock(() => Promise.resolve()) as any;
const mockRequestChanges = mock(() => Promise.resolve()) as any;
const mockGetIssues = mock(() => Promise.resolve([])) as any;
const mockAddIssueComment = mock(() => Promise.resolve({ id: 1 })) as any;
const mockCreateIssue = mock(() =>
  Promise.resolve({
    number: 1,
    title: 'Test',
    body: '',
    state: 'open',
    labels: [],
    authorLogin: 'test',
    url: 'https://github.com/test/repo/issues/1',
  }),
) as any;
const mockHandleWebhook = mock(() => Promise.resolve()) as any;
const mockChangePullRequestBase = mock(() => Promise.resolve()) as any;
const mockMergePullRequest = mock(() => Promise.resolve({ autoQueued: false })) as any;

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
  changePullRequestBase = mockChangePullRequestBase;
  mergePullRequest = mockMergePullRequest;
  syncLocalBranchWithRemote = mock(() => Promise.resolve({ synced: true, detail: 'ok' })) as any;
}

// NOTE: Must mirror every export of config/database — the config barrel
// (config/index.ts) re-exports `ensureDatabaseConnection` from here, and github.ts's
// service imports pull in that barrel. Omitting it makes the barrel re-export throw
// "export 'ensureDatabaseConnection' not found" before any test runs.
mock.module('../../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
// NOTE: Mirror every config/logger export the barrel re-exports (`logger`,
// `createLogger`, `getBackendLogFilePath`) — see the database mock note above.
mock.module('../../../config/logger', () => {
  const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
  return {
    createLogger: () => noopLogger,
    logger: noopLogger,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});
mock.module('../../../services/core/github-service', () => ({
  GitHubService: MockGitHubService,
}));
// Re-export the real schemas - they use elysia's t() which needs to be real
// No mock needed for schemas as they are just type definitions

const { githubRoutes, taskGithubRoutes } = await import('../../../routes/social/github');
const { errorHandler } = await import('../../../middleware/error-handler');

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
  mockChangePullRequestBase.mockReset();
  mockMergePullRequest.mockReset();

  mockIsGhAvailable.mockResolvedValue(true);
  mockIsAuthenticated.mockResolvedValue(true);
  mockSyncPullRequests.mockResolvedValue(5);
  mockSyncIssues.mockResolvedValue(3);
  mockGetPullRequests.mockResolvedValue([]);
  mockGetIssues.mockResolvedValue([]);
  mockChangePullRequestBase.mockResolvedValue(undefined);
  mockMergePullRequest.mockResolvedValue({ autoQueued: false });
}

function createApp() {
  return new Elysia().use(errorHandler).use(githubRoutes);
}

function createTaskApp() {
  return new Elysia().use(errorHandler).use(taskGithubRoutes);
}

describe('GET /github/status', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('GitHub CLIステータスを返すこと', async () => {
    mockIsGhAvailable.mockResolvedValue(true);
    mockIsAuthenticated.mockResolvedValue(true);

    const res = await app.handle(new Request('http://localhost/github/status'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ghAvailable).toBe(true);
    expect(body.authenticated).toBe(true);
  });

  test('GitHub CLI未インストール時のステータスを返すこと', async () => {
    mockIsGhAvailable.mockResolvedValue(false);

    const res = await app.handle(new Request('http://localhost/github/status'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ghAvailable).toBe(false);
    expect(body.authenticated).toBe(false);
  });
});

describe('GET /github/integrations', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('統合一覧を返すこと', async () => {
    const integrations = [
      {
        id: 1,
        repositoryUrl: 'https://github.com/test/repo',
        ownerName: 'test',
        repositoryName: 'repo',
        _count: { pullRequests: 5, issues: 3 },
      },
    ];
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue(integrations);

    const res = await app.handle(new Request('http://localhost/github/integrations'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
  });

  test('空配列を返すこと', async () => {
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request('http://localhost/github/integrations'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe('POST /github/integrations', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('統合を作成すること', async () => {
    const created = {
      id: 1,
      repositoryUrl: 'https://github.com/test/repo',
      ownerName: 'test',
      repositoryName: 'repo',
      syncIssues: true,
      syncPullRequests: true,
      autoLinkTasks: true,
    };
    mockPrisma.gitHubIntegration.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request('http://localhost/github/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repositoryUrl: 'https://github.com/test/repo',
          ownerName: 'test',
          repositoryName: 'repo',
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.repositoryUrl).toBe('https://github.com/test/repo');
  });
});

describe('GET /github/integrations/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('統合詳細を返すこと', async () => {
    const integration = {
      id: 1,
      repositoryUrl: 'https://github.com/test/repo',
      ownerName: 'test',
      repositoryName: 'repo',
      _count: { pullRequests: 5, issues: 3 },
    };
    mockPrisma.gitHubIntegration.findUnique.mockResolvedValue(integration);

    const res = await app.handle(new Request('http://localhost/github/integrations/1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
  });
});

describe('PATCH /github/integrations/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('統合を更新すること', async () => {
    const updated = { id: 1, syncIssues: false, isActive: true };
    mockPrisma.gitHubIntegration.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/github/integrations/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncIssues: false }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.syncIssues).toBe(false);
  });
});

describe('DELETE /github/integrations/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('統合を削除すること', async () => {
    const deleted = { id: 1 };
    mockPrisma.gitHubIntegration.delete.mockResolvedValue(deleted);

    const res = await app.handle(
      new Request('http://localhost/github/integrations/1', {
        method: 'DELETE',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
  });
});

describe('POST /github/integrations/:id/sync-prs', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('PRを同期すること', async () => {
    mockSyncPullRequests.mockResolvedValue(5);

    const res = await app.handle(
      new Request('http://localhost/github/integrations/1/sync-prs', {
        method: 'POST',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.syncedCount).toBe(5);
  });
});

describe('POST /github/integrations/:id/sync-issues', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('Issueを同期すること', async () => {
    mockSyncIssues.mockResolvedValue(3);

    const res = await app.handle(
      new Request('http://localhost/github/integrations/1/sync-issues', {
        method: 'POST',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.syncedCount).toBe(3);
  });
});

describe('GET /github/integrations/:id/pull-requests', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('DBからPR一覧を返すこと', async () => {
    const prs = [
      {
        id: 1,
        prNumber: 42,
        title: 'Feature PR',
        state: 'open',
        _count: { reviews: 0, comments: 1 },
      },
    ];
    mockPrisma.gitHubPullRequest.findMany.mockResolvedValue(prs);

    const res = await app.handle(
      new Request('http://localhost/github/integrations/1/pull-requests'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test('GitHubからPR一覧を取得すること', async () => {
    const integration = { id: 1, ownerName: 'test', repositoryName: 'repo' };
    mockPrisma.gitHubIntegration.findUnique.mockResolvedValue(integration);
    mockGetPullRequests.mockResolvedValue([{ number: 1, title: 'PR' }]);

    const res = await app.handle(
      new Request('http://localhost/github/integrations/1/pull-requests?fromGitHub=true'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('GET /github/pull-requests/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('PR詳細を返すこと', async () => {
    const pr = {
      id: 1,
      prNumber: 42,
      title: 'Feature PR',
      integration: { ownerName: 'test', repositoryName: 'repo' },
      reviews: [],
      comments: [],
    };
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(pr);

    const res = await app.handle(new Request('http://localhost/github/pull-requests/1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.prNumber).toBe(42);
  });
});

describe('GET /github/pull-requests/:id/diff', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('PR差分を返すこと', async () => {
    const pr = {
      id: 1,
      prNumber: 42,
      integration: { ownerName: 'test', repositoryName: 'repo' },
    };
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(pr);
    mockGetPullRequestDiff.mockResolvedValue({ diff: 'diff content' });

    const res = await app.handle(new Request('http://localhost/github/pull-requests/1/diff'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.diff).toBe('diff content');
  });

  test('PRが見つからない場合 404 を返し外部APIを呼ばないこと', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/github/pull-requests/999/diff'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('PR not found');
    expect(body.code).toBe('PR_NOT_FOUND');
    expect(mockGetPullRequestDiff).not.toHaveBeenCalled();
  });
});

describe('POST /github/pull-requests/:id/comments — PR not found guard', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('PRが見つからない場合 404 を返し外部APIを呼ばないこと', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/999/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'comment' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('PR not found');
    expect(body.code).toBe('PR_NOT_FOUND');
    expect(mockCreatePullRequestComment).not.toHaveBeenCalled();
  });
});

describe('POST /github/pull-requests/:id/approve — PR not found guard', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('PRが見つからない場合 404 を返し外部APIを呼ばないこと', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/999/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('PR not found');
    expect(body.code).toBe('PR_NOT_FOUND');
    expect(mockApprovePullRequest).not.toHaveBeenCalled();
  });
});

describe('POST /github/pull-requests/:id/request-changes — PR not found guard', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('PRが見つからない場合 404 を返し外部APIを呼ばないこと', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/999/request-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'needs changes' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('PR not found');
    expect(body.code).toBe('PR_NOT_FOUND');
    expect(mockRequestChanges).not.toHaveBeenCalled();
  });
});

describe('POST /github/pull-requests/:id/merge — PR not found guard', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('PRが見つからない場合 404 を返し外部APIを呼ばないこと', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/999/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('PR not found');
    expect(body.code).toBe('PR_NOT_FOUND');
  });
});

describe('PATCH /github/pull-requests/:id/base — PR not found guard', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('PRが見つからない場合 404 を返すこと', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/999/base', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseBranch: 'main' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('PR not found');
    expect(body.code).toBe('PR_NOT_FOUND');
  });
});

describe('POST /github/pull-requests/:id/resolve-conflicts — PR not found guard', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('PRが見つからない場合 404 を返すこと', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/999/resolve-conflicts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('PR not found');
    expect(body.code).toBe('PR_NOT_FOUND');
  });
});

describe('GET /github/integrations/:id/issues', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('DBからIssue一覧を返すこと', async () => {
    const issues = [{ id: 1, issueNumber: 10, title: 'Bug', state: 'open' }];
    mockPrisma.gitHubIssue.findMany.mockResolvedValue(issues);

    const res = await app.handle(new Request('http://localhost/github/integrations/1/issues'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('GET /github/issues/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('Issue詳細を返すこと', async () => {
    const issue = {
      id: 1,
      issueNumber: 10,
      title: 'Bug',
      integration: { ownerName: 'test', repositoryName: 'repo' },
    };
    mockPrisma.gitHubIssue.findUnique.mockResolvedValue(issue);

    const res = await app.handle(new Request('http://localhost/github/issues/1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.issueNumber).toBe(10);
  });
});

describe('POST /github/webhook', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('Webhookを処理すること', async () => {
    mockHandleWebhook.mockResolvedValue(undefined);

    const res = await app.handle(
      new Request('http://localhost/github/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-event': 'push',
        },
        body: JSON.stringify({ action: 'opened' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test('x-github-eventヘッダーなしでエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/github/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'opened' }),
      }),
    );
    const body = await res.json();

    expect(body.error).toBeDefined();
  });
});

describe('POST /tasks/:id/create-github-issue (taskGithubRoutes)', () => {
  let app: ReturnType<typeof createTaskApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createTaskApp();
  });

  test('タスクからGitHub Issueを作成すること', async () => {
    const task = { id: 1, title: 'Test Task', description: 'description' };
    const integration = { id: 1, ownerName: 'test', repositoryName: 'repo' };
    mockPrisma.task.findUnique.mockResolvedValue(task);
    mockPrisma.gitHubIntegration.findUnique.mockResolvedValue(integration);
    mockCreateIssue.mockResolvedValue({
      number: 42,
      title: 'Test Task',
      body: 'description',
      state: 'open',
      labels: [],
      authorLogin: 'test',
      url: 'https://github.com/test/repo/issues/42',
    });
    mockPrisma.gitHubIssue.create.mockResolvedValue({ id: 1 });
    mockPrisma.task.update.mockResolvedValue({});

    const res = await app.handle(
      new Request('http://localhost/tasks/1/create-github-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId: 1 }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
  });

  test('タスクが見つからない場合エラーを返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/tasks/999/create-github-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId: 1 }),
      }),
    );
    const body = await res.json();

    expect(body.error).toBeDefined();
  });
});

describe('GET /github/pull-requests/by-task/:taskId', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('linkedTaskId で直接解決すること', async () => {
    mockPrisma.gitHubPullRequest.findFirst.mockResolvedValueOnce({
      id: 11,
      prNumber: 3,
      url: 'https://github.com/o/r/pull/3',
      state: 'open',
    });

    const res = await app.handle(new Request('http://localhost/github/pull-requests/by-task/42'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(11);
    // 直接解決時は title フォールバックの backfill 更新を行わない
    expect(mockPrisma.gitHubPullRequest.update).not.toHaveBeenCalled();
  });

  test('未リンクでも title `[Task-{id}]` 一致で解決し backfill すること', async () => {
    // githubPrId が null なので githubPrId 経路の findFirst はスキップされる。
    // 1回目(linkedTaskId)が miss → 2回目(title)で hit。
    mockPrisma.gitHubPullRequest.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 7,
      prNumber: 9,
      url: 'https://github.com/o/r/pull/9',
      state: 'open',
    });
    mockPrisma.task.findUnique.mockResolvedValue({ githubPrId: null });

    const res = await app.handle(new Request('http://localhost/github/pull-requests/by-task/42'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(7);
    // backfill: PR.linkedTaskId と Task.githubPrId を更新
    expect(mockPrisma.gitHubPullRequest.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.task.update).toHaveBeenCalledTimes(1);
    const calls = (mockPrisma.task.update.mock.calls as unknown as any[][]) || [];
    if (calls.length > 0) {
      const taskArg = calls[0][0] as { data: { githubPrId: number } };
      expect(taskArg.data.githubPrId).toBe(9);
    }
  });

  test('title フォールバックは `[Task-{id}]` と `[#{id}]` の両方を照合すること', async () => {
    mockPrisma.gitHubPullRequest.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 7,
      prNumber: 9,
      url: 'https://github.com/o/r/pull/9',
      state: 'open',
    });
    mockPrisma.task.findUnique.mockResolvedValue({ githubPrId: null });

    await app.handle(new Request('http://localhost/github/pull-requests/by-task/42'));

    // 2回目の findFirst (title フォールバック) は両形式を OR で照合する。
    const calls = (mockPrisma.gitHubPullRequest.findFirst.mock.calls as unknown as any[][]) || [];
    if (calls.length > 1) {
      const titleCall = calls[1][0] as {
        where: { OR: Array<{ title: { contains: string } }> };
      };
      const contains = titleCall.where.OR.map((c) => c.title.contains);
      expect(contains).toContain('[Task-42]');
      expect(contains).toContain('[#42]');
    }
  });

  test('PR未作成なら 404 + reason=not_created を返すこと', async () => {
    mockPrisma.gitHubPullRequest.findFirst.mockResolvedValue(null);
    mockPrisma.task.findUnique.mockResolvedValue({ githubPrId: null });
    mockPrisma.activityLog.findFirst.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/github/pull-requests/by-task/999'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.reason).toBe('not_created');
  });

  test('PR作成済みだがローカル未同期なら reason=not_synced + prUrl を返すこと', async () => {
    mockPrisma.gitHubPullRequest.findFirst.mockResolvedValue(null);
    mockPrisma.task.findUnique.mockResolvedValue({ githubPrId: null });
    mockPrisma.activityLog.findFirst.mockResolvedValue({
      metadata: JSON.stringify({ prUrl: 'https://github.com/o/r/pull/12', prNumber: 12 }),
    });

    const res = await app.handle(new Request('http://localhost/github/pull-requests/by-task/999'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.reason).toBe('not_synced');
    expect(body.prUrl).toBe('https://github.com/o/r/pull/12');
    expect(body.prNumber).toBe(12);
  });
});


// Helper: build a minimal PR record shared across guard tests.
function makeOpenPr(overrides: Partial<{ prNumber: number; state: string }> = {}) {
  return {
    id: 1,
    prNumber: overrides.prNumber ?? 42,
    state: overrides.state ?? 'open',
    title: 'Test PR',
    url: 'https://github.com/test/repo/pull/42',
    baseBranch: 'main',
    headBranch: 'feature/test',
    linkedTaskId: null,
    integration: { ownerName: 'test', repositoryName: 'repo' },
  };
}

// ============================================================
// POST /github/pull-requests/:id/approve — guard tests
// ============================================================
describe('POST /github/pull-requests/:id/approve — checkPrActionable guards', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('open PR への承認は 200 を返し approvePullRequest を呼ぶ', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(makeOpenPr());
    mockApprovePullRequest.mockResolvedValue(undefined);
    mockPrisma.notification.create.mockResolvedValue({ id: 1 });

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/1/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'LGTM' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockApprovePullRequest).toHaveBeenCalledTimes(1);
  });

  test('merged PR への承認は 409 を返し approvePullRequest を呼ばない', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(makeOpenPr({ state: 'merged' }));

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/1/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain('open状態ではない');
    expect(mockApprovePullRequest).not.toHaveBeenCalled();
  });

  test('不正な prNumber (0) は 422 を返し approvePullRequest を呼ばない', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(makeOpenPr({ prNumber: 0 }));

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/1/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.success).toBe(false);
    expect(mockApprovePullRequest).not.toHaveBeenCalled();
  });

  test('PR not found は 404 を返す', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/999/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(404);
  });
});

// ============================================================
// POST /github/pull-requests/:id/request-changes — guard tests
// ============================================================
describe('POST /github/pull-requests/:id/request-changes — checkPrActionable guards', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('open PR への変更要求は 200 を返す', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(makeOpenPr());
    mockRequestChanges.mockResolvedValue(undefined);

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/1/request-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Please fix this' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockRequestChanges).toHaveBeenCalledTimes(1);
  });

  test('closed PR への変更要求は 409 を返し requestChanges を呼ばない', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(makeOpenPr({ state: 'closed' }));

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/1/request-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'fix' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(mockRequestChanges).not.toHaveBeenCalled();
  });
});

// ============================================================
// POST /github/pull-requests/:id/merge — guard tests
// ============================================================
describe('POST /github/pull-requests/:id/merge — checkPrActionable guards', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('open PR のマージは 200 を返す', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(makeOpenPr());
    mockMergePullRequest.mockResolvedValue({ autoQueued: false });
    mockPrisma.gitHubPullRequest.update.mockResolvedValue({});
    mockPrisma.notification.create.mockResolvedValue({ id: 1 });

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/1/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'squash' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockMergePullRequest).toHaveBeenCalledTimes(1);
  });

  test('merged PR のマージは 409 を返し mergePullRequest を呼ばない', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(makeOpenPr({ state: 'merged' }));

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/1/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(mockMergePullRequest).not.toHaveBeenCalled();
  });
});

// ============================================================
// POST /github/pull-requests/:id/comments — guard tests
// ============================================================
describe('POST /github/pull-requests/:id/comments — checkPrActionable guards', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('open PR へのコメントは 200 を返す', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(makeOpenPr());
    mockCreatePullRequestComment.mockResolvedValue({ id: 99 });
    mockPrisma.gitHubPRComment.create.mockResolvedValue({ id: 1 });

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/1/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Great work!' }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockCreatePullRequestComment).toHaveBeenCalledTimes(1);
  });

  test('merged PR へのコメントは 200 を返す（requireOpen=false のため許可）', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(makeOpenPr({ state: 'merged' }));
    mockCreatePullRequestComment.mockResolvedValue({ id: 99 });
    mockPrisma.gitHubPRComment.create.mockResolvedValue({ id: 1 });

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/1/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'This was great' }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockCreatePullRequestComment).toHaveBeenCalledTimes(1);
  });

  test('不正な prNumber (0) は 422 を返し createPullRequestComment を呼ばない', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(makeOpenPr({ prNumber: 0 }));

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/1/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'test' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.success).toBe(false);
    expect(mockCreatePullRequestComment).not.toHaveBeenCalled();
  });
});

// ============================================================
// PATCH /github/pull-requests/:id/base — guard tests
// ============================================================
describe('PATCH /github/pull-requests/:id/base — checkPrActionable guards', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('open PR の base 変更は 200 を返す', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(makeOpenPr());
    mockChangePullRequestBase.mockResolvedValue(undefined);
    mockPrisma.gitHubPullRequest.update.mockResolvedValue({});

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/1/base', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseBranch: 'develop' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.baseBranch).toBe('develop');
    expect(mockChangePullRequestBase).toHaveBeenCalledWith('test/repo', 42, 'develop');
  });

  test('merged PR の base 変更は 409 を返し changePullRequestBase を呼ばない', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(makeOpenPr({ state: 'merged' }));

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/1/base', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseBranch: 'develop' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain('open状態ではない');
    expect(mockChangePullRequestBase).not.toHaveBeenCalled();
  });

  test('不正な prNumber (0) は 422 を返す', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(makeOpenPr({ prNumber: 0 }));

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/1/base', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseBranch: 'develop' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.success).toBe(false);
    expect(mockChangePullRequestBase).not.toHaveBeenCalled();
  });

  test('baseBranch が未指定の場合は 400 を返す', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(makeOpenPr());

    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/1/base', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 404 ガード統合テスト — resource-guard 置換後の HTTP ステータス確認
// ---------------------------------------------------------------------------

describe('POST /github/pull-requests/:id/comments — PR not found → 404', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => { resetAllMocks(); app = createApp(); });

  test('PRが存在しない場合 404 + PR_NOT_FOUND を返すこと', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(null);
    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/999/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'comment' }),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.code).toBe('PR_NOT_FOUND');
  });
});

describe('POST /github/pull-requests/:id/approve — PR not found → 404', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => { resetAllMocks(); app = createApp(); });

  test('PRが存在しない場合 404 + PR_NOT_FOUND を返すこと', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(null);
    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/999/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'LGTM' }),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.code).toBe('PR_NOT_FOUND');
  });
});

describe('POST /github/pull-requests/:id/request-changes — PR not found → 404', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => { resetAllMocks(); app = createApp(); });

  test('PRが存在しない場合 404 + PR_NOT_FOUND を返すこと', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(null);
    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/999/request-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'needs work' }),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.code).toBe('PR_NOT_FOUND');
  });
});

describe('POST /github/pull-requests/:id/resolve-conflicts — PR not found → 404', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => { resetAllMocks(); app = createApp(); });

  test('PRが存在しない場合 404 + PR_NOT_FOUND を返すこと', async () => {
    mockPrisma.gitHubPullRequest.findUnique.mockResolvedValue(null);
    const res = await app.handle(
      new Request('http://localhost/github/pull-requests/999/resolve-conflicts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.code).toBe('PR_NOT_FOUND');
  });
});

describe('POST /github/issues/:id/comments — Issue not found → 404', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => { resetAllMocks(); app = createApp(); });

  test('Issueが存在しない場合 404 + ISSUE_NOT_FOUND を返すこと', async () => {
    mockPrisma.gitHubIssue.findUnique.mockResolvedValue(null);
    const res = await app.handle(
      new Request('http://localhost/github/issues/999/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'comment' }),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.code).toBe('ISSUE_NOT_FOUND');
  });
});

describe('POST /github/issues/:id/create-task — Issue not found → 404', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => { resetAllMocks(); app = createApp(); });

  test('Issueが存在しない場合 404 + ISSUE_NOT_FOUND を返すこと', async () => {
    mockPrisma.gitHubIssue.findUnique.mockResolvedValue(null);
    const res = await app.handle(
      new Request('http://localhost/github/issues/999/create-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.code).toBe('ISSUE_NOT_FOUND');
  });
});

describe('POST /tasks/:id/create-github-issue — Integration not found → 404', () => {
  let app: ReturnType<typeof createTaskApp>;
  beforeEach(() => { resetAllMocks(); app = createTaskApp(); });

  test('Integrationが存在しない場合 404 + INTEGRATION_NOT_FOUND を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ id: 1, title: 'Task', description: 'desc' });
    mockPrisma.gitHubIntegration.findUnique.mockResolvedValue(null);
    const res = await app.handle(
      new Request('http://localhost/tasks/1/create-github-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId: 999 }),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.code).toBe('INTEGRATION_NOT_FOUND');
  });
});
