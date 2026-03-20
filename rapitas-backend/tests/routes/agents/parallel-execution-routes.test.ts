/**
 * Parallel Execution Routes テスト
 * 並列実行APIのテスト
 */
import { describe, test, expect, mock } from 'bun:test';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const mockTask = {
  id: 1,
  title: 'Test Task',
  description: 'Test description',
  subtasks: [
    {
      id: 10,
      title: 'Subtask 1',
      description: 'Sub 1',
      priority: 'medium',
      estimatedHours: 1,
      prompts: [],
    },
    {
      id: 11,
      title: 'Subtask 2',
      description: 'Sub 2',
      priority: 'high',
      estimatedHours: 2,
      prompts: [],
    },
  ],
  prompts: [],
  theme: { workingDirectory: '/tmp' },
};

const mockPrisma = {
  task: {
    findUnique: mock(() => Promise.resolve(mockTask)),
  },
  developerModeConfig: {
    findUnique: mock(() => Promise.resolve({ id: 1, taskId: 1, isEnabled: true })),
    create: mock(() => Promise.resolve({ id: 1, taskId: 1, isEnabled: true })),
  },
  agentSession: {
    create: mock(() => Promise.resolve({ id: 1 })),
    findMany: mock(() => Promise.resolve([])),
  },
};

mock.module('../../../config/database', () => ({ prisma: mockPrisma }));

// Mock the parallel execution service
mock.module('../../../services/parallel-execution', () => ({
  createParallelExecutor: mock(() => ({
    startSession: mock(() => Promise.resolve({ sessionId: 'sess-1', status: 'running' })),
    getSession: mock(() => null),
    listSessions: mock(() => []),
  })),
  createDependencyAnalyzer: mock(() => ({
    analyze: mock(() => ({
      treeMap: {
        nodes: new Map(),
        edges: [],
        criticalPath: [],
        parallelGroups: [],
        maxDepth: 0,
      },
      plan: {
        id: 'plan-1',
        executionOrder: [],
        estimatedTotalDuration: 100,
        estimatedSequentialDuration: 200,
        parallelEfficiency: 0.5,
        maxConcurrency: 3,
        groups: [],
        resourceConstraints: {},
      },
      recommendations: [],
      warnings: [],
    })),
  })),
}));

mock.module('../../../services/communication/sse-utils', () => ({
  SSEStreamController: class {
    createStream() {
      return new ReadableStream({
        start(c) {
          c.close();
        },
      });
    }
    sendStart() {}
    sendProgress() {}
    sendData() {}
    sendComplete() {}
    sendError() {}
    close() {}
  },
  getUserFriendlyErrorMessage: mock((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

const { parallelExecutionRoutes } = await import('../../../routes/agents/parallel-execution');

import { Elysia } from 'elysia';
const app = new Elysia().use(parallelExecutionRoutes);

describe('Parallel Execution Routes', () => {
  test('GET /parallel/tasks/:id/analyze - 依存関係分析', async () => {
    const res = await app.handle(new Request('http://localhost/parallel/tasks/1/analyze'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('GET /parallel/tasks/:id/analyze - タスクが見つからない場合', async () => {
    mockPrisma.task.findUnique.mockImplementationOnce(() => Promise.resolve(null));
    const res = await app.handle(new Request('http://localhost/parallel/tasks/999/analyze'));
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test('GET /parallel/tasks/:id/analyze/stream - SSEストリーム', async () => {
    const res = await app.handle(new Request('http://localhost/parallel/tasks/1/analyze/stream'));
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
  });
});
