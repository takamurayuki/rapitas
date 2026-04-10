/**
 * Agent Version Management Routes テスト
 * エージェントバージョン管理（一覧・更新・インストール・アンインストール・履歴）のテスト
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  aIAgentConfig: {
    findMany: mock(() => Promise.resolve([])),
    findFirst: mock(() => Promise.resolve(null)),
    findUnique: mock(() => Promise.resolve(null)),
    update: mock(() => Promise.resolve({})),
  },
  agentConfigAuditLog: {
    findMany: mock(() => Promise.resolve([])),
  },
};

mock.module('../../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../../utils/agent-audit-log', () => ({
  logAgentConfigChange: mock(() => Promise.resolve()),
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { agentVersionManagementRoutes } =
  await import('../../../routes/agents/agent-version/version-routes');

describe('Agent Version Management Routes', () => {
  let app: Elysia;

  beforeEach(() => {
    mockPrisma.aIAgentConfig.findMany.mockReset();
    mockPrisma.aIAgentConfig.findFirst.mockReset();
    mockPrisma.aIAgentConfig.findUnique.mockReset();
    mockPrisma.aIAgentConfig.update.mockReset();
    mockPrisma.agentConfigAuditLog.findMany.mockReset();

    // Set default mock responses
    mockPrisma.aIAgentConfig.findMany.mockResolvedValue([]);
    mockPrisma.aIAgentConfig.findFirst.mockResolvedValue(null);
    mockPrisma.aIAgentConfig.findUnique.mockResolvedValue(null);
    mockPrisma.aIAgentConfig.update.mockResolvedValue({});
    mockPrisma.agentConfigAuditLog.findMany.mockResolvedValue([]);

    app = new Elysia().use(agentVersionManagementRoutes);
  });

  describe('GET /agents/versions', () => {
    it('should return agents with version info', async () => {
      mockPrisma.aIAgentConfig.findMany.mockResolvedValue([
        {
          id: 1,
          agentType: 'claude-code',
          name: 'Claude Code Agent',
          version: '2.0.0',
          latestVersion: '2.1.0',
          isInstalled: true,
          installPath: '/usr/local/agents/claude-code/2.0.0',
          updatedAt: new Date(),
        },
      ]);

      const response = await app.handle(new Request('http://localhost/agents/versions'));

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBe(1);
      expect(data.data[0].agentType).toBe('claude-code');
      expect(data.data[0].availableVersions).toBeDefined();
      expect(data.data[0].hasUpdate).toBe(true);
      expect(data.data[0].status).toBe('installed');
    });
  });

  describe('GET /agent-types/:agentType/versions', () => {
    it('should return versions for existing agent type', async () => {
      mockPrisma.aIAgentConfig.findFirst.mockResolvedValue({
        id: 1,
        agentType: 'claude-code',
        name: 'Claude Code Agent',
        version: '2.0.0',
        latestVersion: '2.1.0',
        isInstalled: true,
        installPath: '/usr/local/agents/claude-code/2.0.0',
      });

      const response = await app.handle(
        new Request('http://localhost/agent-types/claude-code/versions'),
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.agent).toBeDefined();
      expect(data.data.agent.agentType).toBe('claude-code');
      expect(data.data.availableVersions).toBeDefined();
      expect(Array.isArray(data.data.availableVersions)).toBe(true);
    });

    it('should return error for unknown agent type', async () => {
      mockPrisma.aIAgentConfig.findFirst.mockResolvedValue(null);

      const response = await app.handle(
        new Request('http://localhost/agent-types/unknown-type/versions'),
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Agent not found');
    });
  });

  describe('POST /agents/:id/install', () => {
    it('should install agent when not installed', async () => {
      const mockAgent = {
        id: 1,
        agentType: 'claude-code',
        name: 'Claude Code Agent',
        version: null,
        latestVersion: null,
        isInstalled: false,
        installPath: null,
      };
      mockPrisma.aIAgentConfig.findUnique.mockResolvedValue(mockAgent);
      mockPrisma.aIAgentConfig.update.mockResolvedValue({
        ...mockAgent,
        version: '2.1.0',
        latestVersion: '2.1.0',
        isInstalled: true,
        installPath: '/usr/local/agents/claude-code/2.1.0',
      });

      const response = await app.handle(
        new Request('http://localhost/agents/1/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.agent).toBeDefined();
      expect(data.data.message).toContain('Successfully installed');
    });

    it('should return error when already installed', async () => {
      mockPrisma.aIAgentConfig.findUnique.mockResolvedValue({
        id: 1,
        agentType: 'claude-code',
        name: 'Claude Code Agent',
        version: '2.0.0',
        isInstalled: true,
        installPath: '/usr/local/agents/claude-code/2.0.0',
      });

      const response = await app.handle(
        new Request('http://localhost/agents/1/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Agent is already installed');
    });

    it('should return error when agent not found', async () => {
      mockPrisma.aIAgentConfig.findUnique.mockResolvedValue(null);

      const response = await app.handle(
        new Request('http://localhost/agents/999/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Agent not found');
    });
  });

  describe('POST /agents/:id/uninstall', () => {
    it('should uninstall agent when installed', async () => {
      const mockAgent = {
        id: 1,
        agentType: 'claude-code',
        name: 'Claude Code Agent',
        version: '2.0.0',
        isInstalled: true,
        installPath: '/usr/local/agents/claude-code/2.0.0',
      };
      mockPrisma.aIAgentConfig.findUnique.mockResolvedValue(mockAgent);
      mockPrisma.aIAgentConfig.update.mockResolvedValue({
        ...mockAgent,
        version: null,
        isInstalled: false,
        installPath: null,
      });

      const response = await app.handle(
        new Request('http://localhost/agents/1/uninstall', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.message).toContain('Successfully uninstalled');
    });

    it('should return error when not installed', async () => {
      mockPrisma.aIAgentConfig.findUnique.mockResolvedValue({
        id: 1,
        agentType: 'claude-code',
        name: 'Claude Code Agent',
        version: null,
        isInstalled: false,
        installPath: null,
      });

      const response = await app.handle(
        new Request('http://localhost/agents/1/uninstall', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Agent is not installed');
    });

    it('should return error when agent not found', async () => {
      mockPrisma.aIAgentConfig.findUnique.mockResolvedValue(null);

      const response = await app.handle(
        new Request('http://localhost/agents/999/uninstall', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Agent not found');
    });
  });

  describe('GET /agents/:id/version-history', () => {
    it('should return version history for agent', async () => {
      mockPrisma.aIAgentConfig.findUnique.mockResolvedValue({
        id: 1,
        name: 'Claude Code Agent',
        agentType: 'claude-code',
        version: '2.1.0',
        isInstalled: true,
      });
      mockPrisma.agentConfigAuditLog.findMany.mockResolvedValue([
        {
          id: 1,
          agentConfigId: 1,
          action: 'install',
          changeDetails: JSON.stringify({ version: '2.1.0' }),
          previousValues: JSON.stringify({ isInstalled: false }),
          newValues: JSON.stringify({ isInstalled: true }),
          createdAt: new Date(),
        },
      ]);

      const response = await app.handle(new Request('http://localhost/agents/1/version-history'));

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.agent).toBeDefined();
      expect(data.data.agent.id).toBe(1);
      expect(data.data.versionHistory).toBeDefined();
      expect(Array.isArray(data.data.versionHistory)).toBe(true);
      expect(data.data.versionHistory.length).toBe(1);
      expect(data.data.versionHistory[0].action).toBe('install');
    });

    it('should return error when agent not found', async () => {
      mockPrisma.aIAgentConfig.findUnique.mockResolvedValue(null);

      const response = await app.handle(new Request('http://localhost/agents/999/version-history'));

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Agent not found');
    });
  });
});
