/**
 * Agent Execution Config Routes テスト
 * エージェント実行設定の取得・作成・更新・削除のテスト
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  agentExecutionConfig: {
    findUnique: mock(() => Promise.resolve(null)),
    upsert: mock(() => Promise.resolve({ id: 1, taskId: 1 })),
    update: mock(() => Promise.resolve({ id: 1, taskId: 1 })),
    delete: mock(() => Promise.resolve({ id: 1 })),
  },
  task: {
    findUnique: mock(() => Promise.resolve({ id: 1 })),
  },
  aIAgentConfig: {
    findUnique: mock(() => Promise.resolve({ id: 1 })),
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

const { agentExecutionConfigRoutes } =
  await import('../../../routes/agents/config/agent-execution-config');

describe('Agent Execution Config Routes', () => {
  let app: Elysia;

  beforeEach(() => {
    mockPrisma.agentExecutionConfig.findUnique.mockReset();
    mockPrisma.agentExecutionConfig.upsert.mockReset();
    mockPrisma.agentExecutionConfig.update.mockReset();
    mockPrisma.agentExecutionConfig.delete.mockReset();
    mockPrisma.task.findUnique.mockReset();
    mockPrisma.aIAgentConfig.findUnique.mockReset();

    // Set default mock responses
    mockPrisma.agentExecutionConfig.findUnique.mockResolvedValue(null);
    mockPrisma.task.findUnique.mockResolvedValue({ id: 1 });
    mockPrisma.aIAgentConfig.findUnique.mockResolvedValue({ id: 1 });
    mockPrisma.agentExecutionConfig.upsert.mockResolvedValue({
      id: 1,
      taskId: 1,
      agentConfig: null,
    });

    app = new Elysia().use(agentExecutionConfigRoutes);
  });

  describe('GET /agent-execution-config/defaults/values', () => {
    it('should return all default config values', async () => {
      const response = await app.handle(
        new Request('http://localhost/agent-execution-config/defaults/values'),
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
      expect(data.timeoutMs).toBe(900000);
      expect(data.maxRetries).toBe(0);
      expect(data.branchStrategy).toBe('auto');
      expect(data.branchPrefix).toBe('feature/');
      expect(data.autoCommit).toBe(false);
      expect(data.autoCreatePR).toBe(false);
      expect(data.requireApproval).toBe('always');
      expect(data.autoExecuteOnAnalysis).toBe(false);
      expect(data.parallelExecution).toBe(false);
      expect(data.maxConcurrentAgents).toBe(3);
      expect(data.useOptimizedPrompt).toBe(true);
      expect(data.autoCodeReview).toBe(true);
      expect(data.reviewScope).toBe('changes');
      expect(data.notifyOnStart).toBe(true);
      expect(data.notifyOnComplete).toBe(true);
      expect(data.notifyOnError).toBe(true);
      expect(data.notifyOnQuestion).toBe(true);
    });
  });

  describe('GET /agent-execution-config/:taskId', () => {
    it('should return 404 when config not found', async () => {
      mockPrisma.agentExecutionConfig.findUnique.mockResolvedValue(null);

      const response = await app.handle(new Request('http://localhost/agent-execution-config/1'));

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Agent execution config not found');
    });

    it('should return config when found', async () => {
      const mockConfig = {
        id: 1,
        taskId: 1,
        timeoutMs: 900000,
        maxRetries: 0,
        branchStrategy: 'auto',
        agentConfig: {
          id: 1,
          agentType: 'claude-code',
          name: 'Test Agent',
          modelId: 'claude-3',
          isActive: true,
        },
      };
      mockPrisma.agentExecutionConfig.findUnique.mockResolvedValue(mockConfig);

      const response = await app.handle(new Request('http://localhost/agent-execution-config/1'));

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
      expect(data.taskId).toBe(1);
      expect(data.agentConfig).toBeDefined();
    });
  });

  describe('PUT /agent-execution-config/:taskId', () => {
    it('should create or update config', async () => {
      const mockResult = {
        id: 1,
        taskId: 1,
        timeoutMs: 900000,
        branchStrategy: 'auto',
        agentConfig: null,
      };
      mockPrisma.agentExecutionConfig.upsert.mockResolvedValue(mockResult);

      const response = await app.handle(
        new Request('http://localhost/agent-execution-config/1', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeoutMs: 900000, branchStrategy: 'auto' }),
        }),
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
      expect(data.taskId).toBe(1);
    });

    it('should return 404 when task not found', async () => {
      mockPrisma.task.findUnique.mockResolvedValue(null);

      const response = await app.handle(
        new Request('http://localhost/agent-execution-config/999', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeoutMs: 900000 }),
        }),
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Task not found');
    });

    it('should return 400 for invalid branchStrategy', async () => {
      const response = await app.handle(
        new Request('http://localhost/agent-execution-config/1', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branchStrategy: 'invalid' }),
        }),
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid branchStrategy');
    });
  });

  describe('DELETE /agent-execution-config/:taskId', () => {
    it('should return 404 when config not found', async () => {
      mockPrisma.agentExecutionConfig.findUnique.mockResolvedValue(null);

      const response = await app.handle(
        new Request('http://localhost/agent-execution-config/1', {
          method: 'DELETE',
        }),
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Agent execution config not found');
    });

    it('should delete config when found', async () => {
      mockPrisma.agentExecutionConfig.findUnique.mockResolvedValue({
        id: 1,
        taskId: 1,
      });
      mockPrisma.agentExecutionConfig.delete.mockResolvedValue({ id: 1 });

      const response = await app.handle(
        new Request('http://localhost/agent-execution-config/1', {
          method: 'DELETE',
        }),
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe('Agent execution config deleted');
    });
  });
});
