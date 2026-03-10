/**
 * Workflow Routes テスト
 * ワークフローファイル管理操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  task: {
    findUnique: mock(() => Promise.resolve(null)),
    update: mock(() => Promise.resolve({})),
  },
  activityLog: {
    create: mock(() => Promise.resolve({})),
  },
  userSettings: {
    findFirst: mock(() => Promise.resolve(null)),
  },
  agentExecutionConfig: {
    findUnique: mock(() => Promise.resolve(null)),
  },
  notification: {
    create: mock(() => Promise.resolve({})),
  },
};

mock.module('../../../config', () => ({
  prisma: mockPrisma,
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));
mock.module('../../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));
mock.module('../../../utils/mojibake-detector', () => ({
  sanitizeMarkdownContent: (content: string) => ({
    content,
    wasFixed: false,
    issues: [],
  }),
}));
mock.module('../../../services/workflow/complexity-analyzer', () => ({
  analyzeTaskComplexity: () => ({
    complexityScore: 5,
    recommendedMode: 'standard',
    factors: [],
  }),
  getWorkflowModeConfig: () => ({
    lightweight: { name: 'Lightweight' },
    standard: { name: 'Standard' },
    comprehensive: { name: 'Comprehensive' },
  }),
}));
mock.module('../../../services/agents/agent-orchestrator', () => ({
  AgentOrchestrator: {
    getInstance: () => ({
      createBranch: mock(() => Promise.resolve()),
      createCommit: mock(() =>
        Promise.resolve({ hash: 'abc123', branch: 'main', filesChanged: 1 }),
      ),
      createPullRequest: mock(() => Promise.resolve({ success: true })),
      mergePullRequest: mock(() => Promise.resolve({ success: true })),
    }),
  },
}));

// Mock fs/promises
mock.module('fs/promises', () => ({
  readFile: mock(() => Promise.resolve('# Test content')),
  writeFile: mock(() => Promise.resolve()),
  mkdir: mock(() => Promise.resolve()),
  stat: mock(() =>
    Promise.resolve({
      mtime: new Date('2026-01-01'),
      size: 100,
    }),
  ),
}));

const { workflowRoutes } = await import('../../../routes/workflow/workflow');

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
    .use(workflowRoutes);
}

describe('GET /workflow/tasks/:taskId/files', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('ワークフローファイル一覧を返すこと', async () => {
    const task = {
      id: 1,
      title: 'テストタスク',
      themeId: 1,
      workflowStatus: 'draft',
      theme: { id: 1, categoryId: 1, category: { id: 1 } },
    };
    mockPrisma.task.findUnique.mockResolvedValue(task);

    const res = await app.handle(new Request('http://localhost/workflow/tasks/1/files'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty('research');
    expect(body).toHaveProperty('question');
    expect(body).toHaveProperty('plan');
    expect(body).toHaveProperty('verify');
    expect(body).toHaveProperty('workflowStatus');
    expect(body).toHaveProperty('path');
  });

  test('無効なタスクIDで400を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/workflow/tasks/abc/files'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid task ID');
  });

  test('存在しないタスクで404を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(new Request('http://localhost/workflow/tasks/999/files'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Task not found');
  });
});

describe('PUT /workflow/tasks/:taskId/files/:fileType', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('ワークフローファイルを保存すること', async () => {
    const task = {
      id: 1,
      title: 'テストタスク',
      themeId: 1,
      workflowStatus: 'draft',
      theme: { id: 1, categoryId: 1, category: { id: 1 } },
    };
    mockPrisma.task.findUnique.mockResolvedValue(task);
    mockPrisma.task.update.mockResolvedValue({ ...task, workflowStatus: 'research_done' });

    const res = await app.handle(
      new Request('http://localhost/workflow/tasks/1/files/research', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Research content' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.fileType).toBe('research');
  });

  test('無効なタスクIDで400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/workflow/tasks/abc/files/research', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'test' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid task ID');
  });

  test('無効なファイルタイプで400を返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/workflow/tasks/1/files/invalid', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'test' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Invalid file type');
  });

  test('存在しないタスクで404を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/workflow/tasks/999/files/research', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'test' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Task not found');
  });
});
