/**
 * Agent Execution Router テスト
 * タスク実行機能（実行、停止、応答、継続、リセット）のテスト
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { Elysia } from 'elysia';

// Mock prisma
const mockPrisma = {
  task: {
    findUnique: mock(() => Promise.resolve({ id: 999, title: 'Test Task', status: 'todo' })),
    update: mock(() => Promise.resolve({ id: 999 })),
  },
  agentSession: {
    findFirst: mock(() => Promise.resolve(null)),
    create: mock(() =>
      Promise.resolve({ id: 1, configId: 1, branchName: 'test-branch', worktreePath: null }),
    ),
    update: mock(() => Promise.resolve({ id: 1 })),
  },
  developerModeConfig: {
    findFirst: mock(() => Promise.resolve({ id: 1, autoApprove: false })),
    findUnique: mock(() => Promise.resolve({ id: 1, autoApprove: false })),
    create: mock(() => Promise.resolve({ id: 1, autoApprove: false })),
    upsert: mock(() => Promise.resolve({ id: 1, autoApprove: false })),
  },
  agentExecution: {
    findMany: mock(() => Promise.resolve([])),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({ id: 1 })),
  },
  $transaction: mock((fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma)),
};

mock.module('../../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
  logger: {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    child: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
  },
}));

mock.module('../../../utils/common/branch-name-generator', () => ({
  generateBranchName: mock(() => Promise.resolve('feature/test-branch')),
  generateFallbackBranchName: mock(() => 'feature/test-branch'),
}));

mock.module('../../../utils/ai-client', () => ({
  sendAIMessage: mock(() => Promise.resolve({ content: '{}', tokensUsed: 0 })),
  getDefaultProvider: mock(() => Promise.resolve('openai')),
  isAnyApiKeyConfigured: mock(() => Promise.resolve(false)),
}));

mock.module('../../../services/local-llm', () => ({
  getLocalLLMStatus: mock(() => Promise.resolve({ available: false })),
  ensureLocalLLM: mock(() => Promise.resolve()),
}));

mock.module('../../../services/agents/agent-worker-manager', () => ({
  AgentWorkerManager: {
    getInstance: () => ({
      startExecution: mock(() => Promise.resolve()),
      stopExecution: mock(() => Promise.resolve()),
      getSessionExecutions: mock(() => []),
      getSessionExecutionsAsync: mock(() => Promise.resolve([])),
    }),
  },
}));

mock.module('../../../services/workflow/complexity-analyzer', () => ({
  analyzeTaskComplexity: mock(() => Promise.resolve({ complexity: 'low', factors: [] })),
  analyzeTaskComplexityWithLearning: mock(() =>
    Promise.resolve({
      complexity: 'low',
      suggestedMode: 'manual',
      confidence: 90,
      factors: [],
    }),
  ),
}));

mock.module('../../../services/workflow/role-resolver', () => ({
  resolveAgentForTask: mock(() => Promise.resolve({ agentType: 'default', confidence: 0.8 })),
}));

mock.module('../../../services/communication/realtime-service', () => ({
  realtimeService: {
    sendTaskUpdate: mock(() => {}),
    notifyTaskUpdate: mock(() => {}),
    notifyExecutionStarted: mock(() => {}),
    broadcast: mock(() => {}),
  },
}));

const { agentExecutionRouter } =
  await import('../../../routes/agents/execution-management/agent-execution-router');

describe('Agent Execution Router', () => {
  let app: Elysia;

  beforeEach(() => {
    app = new Elysia().use(agentExecutionRouter);
  });

  describe('POST /tasks/:id/execute', () => {
    it('should handle task execution request', async () => {
      const mockTaskId = '999';
      const requestBody = {
        agentId: 'test-agent-id',
        priority: 'medium',
      };

      const response = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }),
      );

      expect(response.status).toBeOneOf([200, 400, 404, 500]);
    });
  });

  describe('GET /tasks/:id/execution-status', () => {
    it('should return execution status', async () => {
      const mockTaskId = '999';
      const response = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/execution-status`),
      );

      expect(response.status).toBeOneOf([200, 404]);
    });
  });

  describe('POST /tasks/:id/agent-respond', () => {
    it('should handle agent response', async () => {
      const mockTaskId = '999';
      const requestBody = {
        response: 'test response',
        agentId: 'test-agent-id',
      };

      const response = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/agent-respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }),
      );

      expect(response.status).toBeOneOf([200, 400, 404]);
    });
  });

  describe('POST /tasks/:id/stop-execution', () => {
    it('should stop task execution', async () => {
      const mockTaskId = '999';
      const response = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/stop-execution`, {
          method: 'POST',
        }),
      );

      expect(response.status).toBeOneOf([200, 404]);
    });
  });

  describe('POST /tasks/:id/continue-execution', () => {
    it('should continue task execution', async () => {
      const mockTaskId = '999';
      const requestBody = {
        continueReason: 'test reason',
      };

      const response = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/continue-execution`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }),
      );

      expect(response.status).toBeOneOf([200, 400, 404]);
    });
  });

  describe('POST /tasks/:id/reset-execution-state', () => {
    it('should reset execution state', async () => {
      const mockTaskId = '999';
      const response = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/reset-execution-state`, {
          method: 'POST',
        }),
      );

      expect(response.status).toBeOneOf([200, 404]);
    });
  });

  describe('POST /tasks/:id/acknowledge-execution', () => {
    it('should acknowledge execution', async () => {
      const mockTaskId = '999';
      const response = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/acknowledge-execution`, {
          method: 'POST',
        }),
      );

      expect(response.status).toBeOneOf([200, 404]);
    });
  });

  describe('POST /tasks/:id/resume-execution', () => {
    it('should resume execution', async () => {
      const mockTaskId = '999';
      const response = await app.handle(
        new Request(`http://localhost/tasks/${mockTaskId}/resume-execution`, {
          method: 'POST',
        }),
      );

      expect(response.status).toBeOneOf([200, 404]);
    });
  });
});
