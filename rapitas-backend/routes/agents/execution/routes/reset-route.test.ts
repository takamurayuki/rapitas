// @ts-nocheck — Loosely-typed mock setup; types are not the concern of this test file.
/**
 * Tests for reset-route's worktreePath handling (task 790 / K-8047): a
 * removeWorktree refusal or failure must NOT clear the DB's worktreePath,
 * since the directory is still on disk.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Pre-defined mock functions — must be defined before mock.module() calls
// ---------------------------------------------------------------------------

const mockDb = {
  developerModeConfig: {
    findUnique: mock(() => Promise.resolve(null)),
  },
  agentExecutionLog: {
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  agentExecution: {
    updateMany: mock(() => Promise.resolve({ count: 0 })),
  },
  task: {
    findUnique: mock(() => Promise.resolve(null)),
    update: mock(() => Promise.resolve({})),
  },
  agentSession: {
    update: mock(() => Promise.resolve({})),
  },
  workflowQueueItem: {
    updateMany: mock(() => Promise.resolve({ count: 0 })),
  },
};

const mockRemoveWorktreeFn = mock(() => Promise.resolve(true));
const mockReleaseTaskExecLock = mock(() => Promise.resolve(undefined));

// ---------------------------------------------------------------------------
// Module mocks — must be registered before dynamic imports
// ---------------------------------------------------------------------------

mock.module('../../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockDb,
}));

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

mock.module('../../../../services/agents/agent-worker-manager', () => ({
  AgentWorkerManager: {
    getInstance: () => ({
      getSessionExecutionsAsync: mock(() => Promise.resolve([])),
      stopExecution: mock(() => Promise.resolve()),
    }),
  },
}));

mock.module('../shared/execution-lock', () => ({
  releaseTaskExecutionLock: mockReleaseTaskExecLock,
}));

// NOTE: All exports provided to prevent named-export resolution errors from index.ts re-exports.
mock.module(
  '../../../../services/agents/orchestrator/git-operations/worktree/worktree-ops',
  () => ({
    removeWorktree: mockRemoveWorktreeFn,
    cleanupStaleWorktrees: mock(() => Promise.resolve(0)),
    cleanupOrphanedWorktrees: mock(() => Promise.resolve(0)),
    createWorktree: mock(() => Promise.resolve('')),
    ensureGitRepository: mock(() => Promise.resolve()),
    validateAndSetupRemote: mock(() => Promise.resolve()),
  }),
);

// ---------------------------------------------------------------------------
// Dynamic imports AFTER mocks are registered
// ---------------------------------------------------------------------------

const { resetRoute } = await import('./reset-route');

const BASE = 'http://localhost/tasks';

function resetMocks() {
  mockDb.developerModeConfig.findUnique.mockReset();
  mockDb.developerModeConfig.findUnique.mockResolvedValue(null);
  mockDb.agentExecutionLog.deleteMany.mockClear();
  mockDb.agentExecution.updateMany.mockClear();
  mockDb.task.findUnique.mockReset();
  mockDb.task.findUnique.mockResolvedValue(null);
  mockDb.task.update.mockClear();
  mockDb.agentSession.update.mockClear();
  mockDb.workflowQueueItem.updateMany.mockClear();
  mockRemoveWorktreeFn.mockReset();
  mockRemoveWorktreeFn.mockResolvedValue(true);
  mockReleaseTaskExecLock.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reset-route worktreePath handling', () => {
  beforeEach(resetMocks);

  it('clears worktreePath and sets revertedChanges=true when removeWorktree returns true', async () => {
    const taskId = 501;
    const worktreePath = '/test/repo/.worktrees/task-501-abc123';

    mockDb.developerModeConfig.findUnique.mockResolvedValue({
      agentSessions: [
        {
          id: 111,
          status: 'completed',
          worktreePath,
          agentExecutions: [],
        },
      ],
    });
    mockDb.task.findUnique.mockResolvedValue({
      workingDirectory: '/test/repo',
      theme: { workingDirectory: null },
    });
    mockRemoveWorktreeFn.mockResolvedValue(true);

    const res = await resetRoute.handle(
      new Request(`${BASE}/${taskId}/reset-execution-state`, { method: 'POST' }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(mockRemoveWorktreeFn).toHaveBeenCalledWith('/test/repo', worktreePath);
    expect(mockDb.agentSession.update).toHaveBeenCalledWith({
      where: { id: 111 },
      data: expect.objectContaining({ worktreePath: null }),
    });
  });

  it('keeps worktreePath and sets revertedChanges=false when removeWorktree returns false', async () => {
    const taskId = 502;
    const worktreePath = '/test/repo/.worktrees/task-502-abc123';

    mockDb.developerModeConfig.findUnique.mockResolvedValue({
      agentSessions: [
        {
          id: 222,
          status: 'completed',
          worktreePath,
          agentExecutions: [],
        },
      ],
    });
    mockDb.task.findUnique.mockResolvedValue({
      workingDirectory: '/test/repo',
      theme: { workingDirectory: null },
    });
    mockRemoveWorktreeFn.mockResolvedValue(false);

    const res = await resetRoute.handle(
      new Request(`${BASE}/${taskId}/reset-execution-state`, { method: 'POST' }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(mockRemoveWorktreeFn).toHaveBeenCalledWith('/test/repo', worktreePath);
    expect(mockDb.agentSession.update).toHaveBeenCalledWith({
      where: { id: 222 },
      data: expect.objectContaining({ worktreePath }),
    });
  });
});
