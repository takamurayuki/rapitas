/**
 * GitHub Integration テスト
 * Webhookハンドリング・PR同期のテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockExecAsync = mock(() => Promise.resolve({ stdout: '', stderr: '' }));

mock.module('child_process', () => ({
  exec: (_cmd: string, _opts: unknown, cb: Function) => {
    mockExecAsync()
      .then((r) => cb(null, r))
      .catch((e) => cb(e));
  },
}));
mock.module('util', () => ({
  promisify: () => mockExecAsync,
}));

const mockPrisma = {
  gitHubIntegration: {
    findUnique: mock(() => Promise.resolve(null)),
    findFirst: mock(() => Promise.resolve(null)),
  },
  gitHubPullRequest: {
    upsert: mock(() => Promise.resolve({})),
  },
  gitHubIssue: {
    upsert: mock(() => Promise.resolve({})),
  },
  notification: {
    create: mock(() => Promise.resolve({})),
  },
};

mock.module('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      return mockPrisma;
    }
  },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));
mock.module('../../services/realtime-service', () => ({
  realtimeService: { sendGitHubEvent: mock(() => {}) },
}));

const { GitHubService } = await import('../../services/github-service');

function resetAllMocks() {
  mockExecAsync.mockReset();
  for (const model of Object.values(mockPrisma)) {
    for (const method of Object.values(model)) {
      if (typeof method === 'function' && 'mockReset' in method) {
        (method as ReturnType<typeof mock>).mockReset();
      }
    }
  }
}

describe('GitHub Integration - Webhook Handling', () => {
  let service: InstanceType<typeof GitHubService>;

  beforeEach(() => {
    resetAllMocks();
    service = new GitHubService(mockPrisma as any);
  });

  test('pull_request openedイベントを処理できること', async () => {
    mockPrisma.gitHubIntegration.findFirst.mockResolvedValue({
      id: 1,
      ownerName: 'owner',
      repositoryName: 'repo',
    });
    mockPrisma.gitHubPullRequest.upsert.mockResolvedValue({});

    await service.handleWebhook('pull_request', {
      action: 'opened',
      repository: {
        name: 'repo',
        html_url: 'https://github.com/owner/repo',
        owner: { login: 'owner' },
      },
      pull_request: {
        number: 1,
        title: 'New PR',
        body: 'description',
        state: 'open',
        head: { ref: 'feature' },
        base: { ref: 'main' },
        user: { login: 'dev' },
        html_url: 'https://github.com/owner/repo/pull/1',
      },
    });
    // Should complete without error
  });

  test('issuesイベントを処理できること', async () => {
    await service.handleWebhook('issues', {
      action: 'opened',
      repository: {
        name: 'repo',
        html_url: 'https://github.com/owner/repo',
        owner: { login: 'owner' },
      },
      issue: {
        number: 5,
        title: 'Bug',
        body: 'fix this',
        state: 'open',
        labels: [],
        user: { login: 'reporter' },
        html_url: 'https://github.com/owner/repo/issues/5',
      },
    });
  });

  test('未対応のactionでもエラーにならないこと', async () => {
    await service.handleWebhook('pull_request', {
      action: 'labeled',
      repository: {
        name: 'repo',
        html_url: 'https://github.com/owner/repo',
        owner: { login: 'owner' },
      },
      pull_request: {
        number: 1,
        title: 'PR',
        body: null,
        state: 'open',
        head: { ref: 'feat' },
        base: { ref: 'main' },
        user: { login: 'dev' },
        html_url: 'https://github.com/owner/repo/pull/1',
      },
    });
  });

  test('PR同期がIntegration未登録でエラーになること', async () => {
    mockPrisma.gitHubIntegration.findUnique.mockResolvedValue(null);
    await expect(service.syncPullRequests(999)).rejects.toThrow('Integration not found');
  });

  test('PR同期が正常にカウントを返すこと', async () => {
    mockPrisma.gitHubIntegration.findUnique.mockResolvedValue({
      id: 1,
      ownerName: 'owner',
      repositoryName: 'repo',
    });
    mockExecAsync.mockResolvedValue({
      stdout: JSON.stringify([
        {
          number: 10,
          title: 'Sync PR',
          body: null,
          state: 'OPEN',
          headRefName: 'dev',
          baseRefName: 'main',
          author: { login: 'dev' },
          url: 'https://github.com/owner/repo/pull/10',
          createdAt: '2026-03-01T00:00:00Z',
          updatedAt: '2026-03-01T00:00:00Z',
        },
      ]),
      stderr: '',
    });
    mockPrisma.gitHubPullRequest.upsert.mockResolvedValue({});

    const count = await service.syncPullRequests(1);
    expect(count).toBe(1);
  });
});
