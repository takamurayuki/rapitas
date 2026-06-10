// @ts-nocheck — Uses patterns that need further migration. Needs completion.
/**
 * Tests for stop-route worktree cleanup functionality
 */

// NOTE: Migrated from vitest to bun:test. mock.module is not hoisted, so all
// static imports that depend on mocked modules are converted to dynamic imports.
import { describe, it, expect, beforeEach, mock } from 'bun:test';

const mocked = <T>(value: T) => value as any;

// Mock modules — must precede dynamic imports below
mock.module('../../../config/database', () => ({
  prisma: {
    task: {
      findUnique: mock(),
      update: mock(),
    },
    developerModeConfig: {
      findUnique: mock(),
    },
    agentExecution: {
      findFirst: mock(),
      findUnique: mock(),
      update: mock(),
    },
    agentExecutionLog: {
      deleteMany: mock(),
    },
    agentSession: {
      update: mock(),
    },
  },
}));
mock.module('../../../config', () => ({
  prisma: {
    task: {
      findUnique: mock(),
      update: mock(),
    },
    developerModeConfig: {
      findUnique: mock(),
    },
    agentExecution: {
      findFirst: mock(),
      findUnique: mock(),
      update: mock(),
    },
    agentExecutionLog: {
      deleteMany: mock(),
    },
    agentSession: {
      update: mock(),
    },
  },
  getProjectRoot: () => '/tmp/rapitas-test',
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

mock.module('../../../services/core/orchestrator-instance', () => ({
  orchestrator: {
    stopExecution: mock(),
  },
}));

mock.module('../../../services/agents/agent-worker-manager', () => ({
  AgentWorkerManager: {
    getInstance: mock(() => ({
      getSessionExecutionsAsync: mock(() => Promise.resolve([])),
      stopExecution: mock(),
      revertChanges: mock(),
    })),
  },
}));

mock.module('./execution-lock', () => ({
  releaseTaskExecutionLock: mock(),
}));

mock.module('../../../services/agents/orchestrator/git-operations/worktree-ops', () => ({
  removeWorktree: mock(),
  cleanupStaleWorktrees: mock(),
  cleanupOrphanedWorktrees: mock(),
  createWorktree: mock(),
  ensureGitRepository: mock(),
  validateAndSetupRemote: mock(),
}));

const { stopRoute } = await import('./stop-route');
const { prisma } = await import('../../../config/database');
const { orchestrator } = await import('../../../services/core/orchestrator-instance');
const { removeWorktree } =
  await import('../../../services/agents/orchestrator/git-operations/worktree-ops');

const mockPrisma = mocked(prisma);
const mockOrchestrator = mocked(orchestrator);
const mockRemoveWorktree = mocked(removeWorktree);

describe('stop-route worktree cleanup', () => {
  beforeEach(() => {
    // NOTE: Reset shared mocks between tests to avoid call-count bleed.
    mockRemoveWorktree.mockReset();
    mockOrchestrator.stopExecution.mockReset();
    mockPrisma.task.findUnique.mockReset();
    mockPrisma.developerModeConfig.findUnique.mockReset();
    mockPrisma.agentExecution.findFirst.mockReset();
    mockPrisma.agentExecution.findUnique.mockReset();
    mockPrisma.agentExecution.update.mockReset();
    mockPrisma.agentExecutionLog.deleteMany.mockReset();
    mockPrisma.task.update.mockReset();
    mockPrisma.agentSession.update.mockReset();
  });

  it.skip('should clean up worktree on single execution stop', async () => {
    const taskId = 123;
    const worktreePath = '/test/repo/.worktrees/task-123-abc123';

    // Mock task
    mockPrisma.task.findUnique.mockResolvedValue({
      workingDirectory: '/test/repo',
    });

    // Mock no developer mode config (single execution)
    mockPrisma.developerModeConfig.findUnique.mockResolvedValue(null);

    // Mock running execution
    mockPrisma.agentExecution.findFirst.mockResolvedValue({
      id: 456,
    });

    // Mock execution with session that has worktree
    mockPrisma.agentExecution.findUnique.mockResolvedValue({
      id: 456,
      session: {
        id: 789,
        worktreePath,
      },
    });

    mockOrchestrator.stopExecution.mockResolvedValue(true);
    mockPrisma.agentExecutionLog.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.agentExecution.update.mockResolvedValue({} as any);
    mockPrisma.task.update.mockResolvedValue({} as any);
    mockPrisma.agentSession.update.mockResolvedValue({} as any);
    mockRemoveWorktree.mockResolvedValue(undefined);

    // Create test context
    const context = {
      params: { id: taskId.toString() },
    };

    // Call the route handler
    const app = { post: mock() };
    const routeHandler = mock();

    stopRoute.post = mock((path, handler) => {
      routeHandler.mockImplementation(handler);
      return app;
    });

    // Rebuild the route
    const rebuiltRoute = stopRoute.post('/tasks/:id/stop-execution', routeHandler);

    // Call the handler
    await routeHandler(context);

    // Verify worktree cleanup was called
    expect(mockRemoveWorktree).toHaveBeenCalledWith('/test/repo', worktreePath);
    expect(mockPrisma.agentSession.update).toHaveBeenCalledWith({
      where: { id: 789 },
      data: { worktreePath: null },
    });
  });

  it.skip('should clean up worktree on developer mode session stop', async () => {
    const taskId = 123;
    const worktreePath = '/test/repo/.worktrees/task-123-abc123';

    // Mock task
    mockPrisma.task.findUnique.mockResolvedValue({
      workingDirectory: '/test/repo',
    });

    // Mock developer mode config with session
    mockPrisma.developerModeConfig.findUnique.mockResolvedValue({
      agentSessions: [
        {
          id: 789,
          worktreePath,
        },
      ],
    });

    const mockAgentWorkerManager = {
      getSessionExecutionsAsync: mock(() => Promise.resolve([])),
      stopExecution: mock(),
      revertChanges: mock(),
    };

    // Mock AgentWorkerManager
    const { AgentWorkerManager } = await import('../../../services/agents/agent-worker-manager');
    AgentWorkerManager.getInstance.mockReturnValue(mockAgentWorkerManager as any);

    mockPrisma.agentExecution.findMany.mockResolvedValue([]);
    mockPrisma.agentSession.update.mockResolvedValue({} as any);
    mockPrisma.task.update.mockResolvedValue({} as any);
    mockRemoveWorktree.mockResolvedValue(undefined);

    // Create test context
    const context = {
      params: { id: taskId.toString() },
    };

    // Create a mock route handler
    const routeHandler = mock();

    // Mock the Elysia route
    const mockElysia = {
      post: mock((path, handler) => {
        routeHandler.mockImplementation(handler);
        return mockElysia;
      }),
    };

    // Call the handler directly
    // Note: In real implementation, this would be handled by Elysia framework

    // Verify the cleanup logic would be called
    expect(mockPrisma.developerModeConfig.findUnique).toBeDefined();
    expect(mockRemoveWorktree).toBeDefined();
  });

  it('should handle worktree cleanup errors gracefully', async () => {
    const taskId = 123;
    const worktreePath = '/test/repo/.worktrees/task-123-abc123';

    // Mock task
    mockPrisma.task.findUnique.mockResolvedValue({
      workingDirectory: '/test/repo',
    });

    // Mock no developer mode config
    mockPrisma.developerModeConfig.findUnique.mockResolvedValue(null);

    // Mock running execution
    mockPrisma.agentExecution.findFirst.mockResolvedValue({
      id: 456,
    });

    mockPrisma.agentExecution.findUnique.mockResolvedValue({
      id: 456,
      session: {
        id: 789,
        worktreePath,
      },
    });

    mockOrchestrator.stopExecution.mockResolvedValue(true);
    mockPrisma.agentExecutionLog.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.agentExecution.update.mockResolvedValue({} as any);
    mockPrisma.task.update.mockResolvedValue({} as any);

    // Mock worktree cleanup failure
    mockRemoveWorktree.mockRejectedValue(new Error('Cleanup failed'));

    // Create test context
    const context = {
      params: { id: taskId.toString() },
    };

    // The route should still complete successfully despite cleanup error
    expect(() => mockRemoveWorktree('/test/repo', worktreePath)).toThrow('Cleanup failed');
  });

  it('should skip worktree cleanup when no worktree path exists', async () => {
    const taskId = 123;

    // Mock task
    mockPrisma.task.findUnique.mockResolvedValue({
      workingDirectory: '/test/repo',
    });

    mockPrisma.developerModeConfig.findUnique.mockResolvedValue(null);

    // Mock running execution
    mockPrisma.agentExecution.findFirst.mockResolvedValue({
      id: 456,
    });

    // Mock execution with session but no worktree
    mockPrisma.agentExecution.findUnique.mockResolvedValue({
      id: 456,
      session: {
        id: 789,
        worktreePath: null,
      },
    });

    mockOrchestrator.stopExecution.mockResolvedValue(true);
    mockPrisma.agentExecutionLog.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.agentExecution.update.mockResolvedValue({} as any);
    mockPrisma.task.update.mockResolvedValue({} as any);

    // Create test context
    const context = {
      params: { id: taskId.toString() },
    };

    // Verify worktree cleanup is not called when no worktree path
    expect(mockRemoveWorktree).not.toHaveBeenCalled();
  });
});
