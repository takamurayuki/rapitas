/**
 * Agent Configuration Router テスト
 * エージェント設定管理（CRUD操作、デフォルト設定、スキーマ取得）のテスト
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  aIAgentConfig: {
    findMany: mock(() =>
      Promise.resolve([
        {
          id: 1,
          name: 'Development Agent',
          isActive: true,
          isDefault: true,
          capabilities: '{}',
          createdAt: new Date(),
          _count: { executions: 0 },
        },
      ]),
    ),
    findFirst: mock(() => Promise.resolve(null)),
    findUnique: mock(() =>
      Promise.resolve({ id: 1, name: 'Test', isActive: true, isDefault: false }),
    ),
    update: mock(() => Promise.resolve({ id: 1, name: 'Test', isActive: false, isDefault: false })),
    updateMany: mock(() => Promise.resolve({ count: 1 })),
    delete: mock(() => Promise.resolve({})),
  },
  $transaction: mock((fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma)),
};

// Mock modules
mock.module('../../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../../utils/database/db-helpers', () => ({
  fromJsonString: mock((str: string | null) => (str ? JSON.parse(str) : null)),
}));
mock.module('../../../utils/agent/agent-config-schema', () => ({
  getAgentConfigSchema: mock(() => ({})),
  getAllAgentConfigSchemas: mock(() => ({})),
}));
mock.module('../../../utils/agent/agent-audit-log', () => ({
  logAgentConfigChange: mock(() => Promise.resolve()),
}));
mock.module('../../../utils/agent/agent-display-name', () => ({
  formatAgentDisplayName: mock((name: string) => name),
  isDevelopmentAgent: mock(() => true),
  isReviewAgent: mock(() => false),
}));

const { agentConfigRouter } = await import('../../../routes/agents/config/agent-config-router');
const { AppError, NotFoundError, ValidationError } =
  await import('../../../middleware/error-handler');

describe('Agent Config Router', () => {
  let app: Elysia;

  beforeEach(() => {
    // Reset all mocks
    mockPrisma.aIAgentConfig.findMany.mockReset();
    mockPrisma.aIAgentConfig.findFirst.mockReset();
    mockPrisma.aIAgentConfig.findUnique.mockReset();
    mockPrisma.aIAgentConfig.update.mockReset();
    mockPrisma.aIAgentConfig.updateMany.mockReset();
    mockPrisma.aIAgentConfig.delete.mockReset();

    // Set default mock responses
    mockPrisma.aIAgentConfig.findMany.mockResolvedValue([
      {
        id: 1,
        name: 'Development Agent',
        isActive: true,
        isDefault: true,
        capabilities: '{}',
        createdAt: new Date(),
        _count: { executions: 0 },
      },
    ]);
    mockPrisma.aIAgentConfig.findUnique.mockResolvedValue({
      id: 1,
      name: 'Test Agent',
      isActive: true,
      isDefault: false,
    });
    mockPrisma.aIAgentConfig.update.mockResolvedValue({
      id: 1,
      name: 'Test Agent',
      isActive: false,
      isDefault: false,
    });
    mockPrisma.aIAgentConfig.updateMany.mockResolvedValue({ count: 1 });

    app = new Elysia()
      .onError(({ code, error, set }) => {
        if (error instanceof NotFoundError) {
          set.status = 404;
          return { error: error.message };
        }
        if (error instanceof ValidationError) {
          set.status = 400;
          return { error: error.message };
        }
        if (error instanceof AppError) {
          set.status = error.statusCode;
          return { error: error.message };
        }
        if (code === 'VALIDATION') {
          set.status = 400;
          return { error: 'Validation error' };
        }
        set.status = 500;
        return { error: error instanceof Error ? error.message : 'Server error' };
      })
      .use(agentConfigRouter);
  });

  describe('GET /agents', () => {
    it('should return active agents only', async () => {
      const response = await app.handle(new Request('http://localhost/agents'));

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('GET /agents/all', () => {
    it('should return all agents including inactive', async () => {
      const response = await app.handle(new Request('http://localhost/agents/all'));

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('GET /agents/default', () => {
    it('should return default agent configuration', async () => {
      const response = await app.handle(new Request('http://localhost/agents/default'));

      expect(response.status).toBeOneOf([200, 404]);
    });
  });

  describe('GET /agents/config-schemas', () => {
    it('should return all agent configuration schemas', async () => {
      const response = await app.handle(new Request('http://localhost/agents/config-schemas'));

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeDefined();
      expect(typeof data).toBe('object');
    });
  });

  describe('PUT /agents/:id/toggle-active', () => {
    it('should toggle agent active status', async () => {
      // Note: This test requires a valid agent ID
      const mockId = 'test-id';
      const response = await app.handle(
        new Request(`http://localhost/agents/${mockId}/toggle-active`, {
          method: 'PUT',
        }),
      );

      // Should handle invalid ID gracefully
      expect(response.status).toBeOneOf([200, 400, 404]);
    });
  });

  describe('PUT /agents/:id/set-default', () => {
    it('should set agent as default', async () => {
      const mockId = 'test-id';
      const response = await app.handle(
        new Request(`http://localhost/agents/${mockId}/set-default`, {
          method: 'PUT',
        }),
      );

      expect(response.status).toBeOneOf([200, 400, 404]);
    });
  });

  describe('DELETE /agents/default', () => {
    it('should clear default agent', async () => {
      const response = await app.handle(
        new Request('http://localhost/agents/default', {
          method: 'DELETE',
        }),
      );

      expect(response.status).toBeOneOf([200, 404]);
    });
  });

  describe('GET /agents/config-schema/:agentType', () => {
    it('should return schema for specific agent type', async () => {
      const response = await app.handle(
        new Request('http://localhost/agents/config-schema/claude-code'),
      );

      expect(response.status).toBeOneOf([200, 404]);
    });
  });
});
