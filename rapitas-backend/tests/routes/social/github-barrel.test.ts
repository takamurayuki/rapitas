/**
 * GitHub Routes Barrel Integration Tests
 *
 * Verifies that routes/social/github.ts correctly composes all 4 sub-route
 * modules under the /github prefix and re-exports taskGithubRoutes as an
 * independent Elysia instance. Tests static export existence and HTTP-level
 * route mounting.
 */
import { describe, test, expect, mock } from 'bun:test';
import { Elysia } from 'elysia';

// NOTE: All mock.module declarations must be identical in form to github-routes.test.ts
// so that either file can run first in the same bun process without mock collisions.
// Identical module shapes are process-globally safe.

// HACK(agent): Bun mock型推論の制限
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

class MockGitHubService {
  isGhAvailable = mock(() => Promise.resolve(true)) as any;
  isAuthenticated = mock(() => Promise.resolve(true)) as any;
  syncPullRequests = mock(() => Promise.resolve(5)) as any;
  syncIssues = mock(() => Promise.resolve(3)) as any;
  getPullRequests = mock(() => Promise.resolve([])) as any;
  getPullRequestDiff = mock(() => Promise.resolve({ diff: '' })) as any;
  createPullRequestComment = mock(() => Promise.resolve({ id: 1 })) as any;
  approvePullRequest = mock(() => Promise.resolve()) as any;
  requestChanges = mock(() => Promise.resolve()) as any;
  getIssues = mock(() => Promise.resolve([])) as any;
  addIssueComment = mock(() => Promise.resolve({ id: 1 })) as any;
  createIssue = mock(() =>
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
  handleWebhook = mock(() => Promise.resolve()) as any;
  changePullRequestBase = mock(() => Promise.resolve()) as any;
  mergePullRequest = mock(() => Promise.resolve({ autoQueued: false })) as any;
  syncLocalBranchWithRemote = mock(() => Promise.resolve({ synced: true, detail: 'ok' })) as any;
  listRepositories = mock(() => Promise.resolve([])) as any;
}

// NOTE: Must mirror every export of config/database — identical to github-routes.test.ts.
mock.module('../../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
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
// NOTE: Mirror all exports from actions.ts — identical form to github-routes.test.ts.
mock.module('../../../services/github/actions', () => ({
  listWorkflowRuns: mock(() => Promise.resolve([])),
  getWorkflowRun: mock(() => Promise.resolve({ id: 1, status: 'completed' })),
  getWorkflowRunLog: mock(() => Promise.resolve('log content')),
  getWorkflowJobLog: mock(() => Promise.resolve([{ name: 'step', lines: [] }])),
}));
// NOTE: Mirror all 6 exports of concern-bridge — identical form to github-routes.test.ts.
mock.module('../../../services/github/concern-bridge', () => ({
  publishConcernToIssue: mock(() => Promise.resolve({ success: true, issue: {} })),
  importIssueAsConcern: mock(() => Promise.resolve({ success: true, concernId: 1 })),
  resolveConcernIntegration: mock(() => Promise.resolve({ id: 1 })),
  labelValue: () => undefined,
  buildIssueContent: () => ({ title: '', body: '' }),
  closeIssueForConcern: () => Promise.resolve(),
}));
// NOTE: Mirror conflict-resolver — identical form to github-routes.test.ts.
mock.module('../../../services/github/conflict-resolver', () => ({
  resolvePrConflicts: mock(() => Promise.resolve({ resolved: true, conflicts: [], detail: 'ok' })),
}));

const { githubRoutes, taskGithubRoutes } = await import('../../../routes/social/github');
const { errorHandler } = await import('../../../middleware/error-handler');

// ---------------------------------------------------------------------------
// 静的 export 存在検証
// ---------------------------------------------------------------------------

describe('バレル export の存在検証', () => {
  test('githubRoutes が export されていること', () => {
    expect(githubRoutes).toBeDefined();
  });

  test('taskGithubRoutes が named re-export されていること', () => {
    expect(taskGithubRoutes).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// バレル合成: 4 サブモジュールが全マウントされているか
// Elysia は未定義ルートに 404 { message: 'Not Found' } を返す。
// 各代表ルートへのリクエストが routing-404 でないことを確認する。
// ---------------------------------------------------------------------------

describe('githubRoutes バレル合成 — 4 サブモジュール全マウント検証', () => {
  let app: Elysia;

  // NOTE: App is created once per describe block to avoid re-instantiation overhead.
  // All prisma mocks default to null/[] which is safe for these probe requests.
  app = new Elysia().use(errorHandler).use(githubRoutes);

  test('integrationRoutes: GET /github/integrations が routing-404 なしで応答すること', async () => {
    const res = await app.handle(new Request('http://localhost/github/integrations'));
    const body = await res.json();
    // Routing 404 from Elysia returns { message: 'Not Found' }
    expect(res.status).toBe(200);
    expect((body as any)?.message).not.toBe('Not Found');
  });

  test('pullRequestRoutes: GET /github/pull-requests/1 が routing-404 なしで応答すること', async () => {
    const res = await app.handle(new Request('http://localhost/github/pull-requests/1'));
    // Route is mounted even if body is empty (findUnique→null returns empty body)
    expect(res.status).not.toBe(404);
    // Ensure it's not the Elysia routing-level 404
    const text = await res.text();
    expect(text).not.toBe('{"message":"Not Found"}');
  });

  test('issueRoutes: GET /github/issues/1 が routing-404 なしで応答すること', async () => {
    const res = await app.handle(new Request('http://localhost/github/issues/1'));
    expect(res.status).not.toBe(404);
    const text = await res.text();
    expect(text).not.toBe('{"message":"Not Found"}');
  });

  test('ciActionRoutes: GET /github/integrations/1/runs が routing-404 なしで応答すること', async () => {
    const res = await app.handle(new Request('http://localhost/github/integrations/1/runs'));
    const body = await res.json();
    // integration not found → returns [] (not a routing 404)
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// taskGithubRoutes の独立性検証（githubRoutes とは別系統・prefix 無し）
// ---------------------------------------------------------------------------

describe('taskGithubRoutes の独立インスタンス検証', () => {
  test('POST /tasks/:id/create-github-issue が独立 Elysia インスタンスで応答すること', async () => {
    const taskApp = new Elysia().use(errorHandler).use(taskGithubRoutes);

    const res = await taskApp.handle(
      new Request('http://localhost/tasks/1/create-github-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integrationId: 1 }),
      }),
    );
    const body = await res.json();

    // task not found → { error: 'Task not found' } with 200 (not a routing 404)
    expect(res.status).toBe(200);
    expect((body as any)?.message).not.toBe('Not Found');
  });
});
