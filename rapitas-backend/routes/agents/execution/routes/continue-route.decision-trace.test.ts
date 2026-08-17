// @ts-nocheck — Loosely-typed mock setup; types are not the concern of this test file.
/**
 * continue-route.decision-trace.test.ts
 *
 * Spy test for the decision-audit instrumentation in POST
 * /tasks/:id/continue-execution: verifies recordDecision is invoked with
 * kind=resource_access and the worktree decision as adoptedId. Heavy route
 * dependencies are stubbed via mock.module (process-global — run this file
 * in isolation).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockRecordDecision = mock(() => Promise.resolve()) as ReturnType<typeof mock>;

// HACK(agent): bun の mock.module はプロセスグローバルなため、バレルの全エクスポートを
// ミラーしないと他 import が "export not found" をスローする。
mock.module('../../../../services/observability/decision-trace', () => ({
  recordDecision: mockRecordDecision,
  getDecisionDag: () => Promise.resolve({ nodes: [], edges: [] }),
  runConsistencyCheckBatch: () => Promise.resolve({ checked: 0, updated: 0 }),
  judgeConsistency: () => ({ consistency: 'skipped', note: '' }),
  maskSensitive: (v) => ({ masked: v, maskedFieldCount: 0 }),
  maskStringValue: (v) => ({ masked: v, count: 0 }),
}));

const mockDb = {
  agentSession: { update: mock(() => Promise.resolve({})) },
  task: { update: mock(() => Promise.resolve({})) },
  notification: { create: mock(() => Promise.resolve({})) },
};

mock.module('../../../../config/database', () => ({
  prisma: mockDb,
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

mock.module('../../../../config', () => ({
  prisma: mockDb,
  getProjectRoot: () => '/tmp/rapitas-test',
  createLogger: () => noopLogger,
}));

const mockExecuteTask = mock(() => Promise.resolve({ success: true }));
const mockCreateWorktree = mock(() => Promise.resolve('/tmp/rapitas-test/.worktrees/task-3'));
mock.module('../../../../services/agents/agent-worker-manager', () => ({
  AgentWorkerManager: {
    getInstance: () => ({
      getActiveExecutionCountAsync: mock(() => Promise.resolve(0)),
      createWorktree: mockCreateWorktree,
      createBranch: mock(() => Promise.resolve()),
      executeTask: mockExecuteTask,
    }),
  },
}));

mock.module(
  '../../../../services/agents/orchestrator/git-operations/worktree/worktree-guard',
  () => ({
    isPrimaryWorkTree: mock(() => Promise.resolve(false)),
  }),
);

mock.module('../../../../middleware/rate-limiter', () => ({
  agentRateLimiter: mock(() => true),
}));

mock.module('../shared/execution-lock', () => ({
  acquireTaskExecutionLock: mock(() => true),
  releaseTaskExecutionLock: mock(() => {}),
}));

mock.module('../post-handlers/continue-post-handler', () => ({
  handleContinueResult: mock(() => Promise.resolve()),
  handleContinueError: mock(() => Promise.resolve()),
}));

mock.module('../../../../services/task/task-resolver', () => ({
  resolveTaskForExecution: mock(() =>
    Promise.resolve({
      id: 3,
      title: '継続タスク',
      executionInstructions: null,
      theme: { workingDirectory: '/tmp/rapitas-test/repo', repositoryUrl: null },
      developerModeConfig: { id: 30 },
    }),
  ),
}));

mock.module('../../../../services/agents/agent-session-resolver', () => ({
  resolveLatestFinishedSession: mock(() => Promise.resolve(null)),
  resolveSessionWithLatestExecution: mock(() =>
    Promise.resolve({
      id: 55,
      branchName: 'feature/task-3',
      worktreePath: null, // no recorded worktree + known branch → decideWorktree = 'recreate'
      agentExecutions: [{ id: 77, status: 'completed', output: null, agentConfigId: 5 }],
    }),
  ),
}));

const { continueRoute } = await import('./continue-route');

beforeEach(() => {
  mockRecordDecision.mockReset();
  mockRecordDecision.mockResolvedValue(undefined);
});

describe('continue-execution decision-trace instrumentation', () => {
  it('records a resource_access decision with the worktree verdict as adoptedId', async () => {
    const res = await continueRoute.handle(
      new Request('http://localhost/tasks/3/continue-execution', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: '続きをやる', sessionId: 55 }),
      }),
    );
    const body = await res.json();
    expect(body.success).toBe(true);

    expect(mockRecordDecision).toHaveBeenCalledTimes(1);
    const input = mockRecordDecision.mock.calls[0][0];
    expect(input.kind).toBe('resource_access');
    expect(input.taskId).toBe(3);
    expect(input.sessionId).toBe(55);
    expect(input.executionId).toBe(77);
    expect(input.nodeKey).toContain('task3:worktree-decision:');
    // worktreePath=null + branchName known → 'recreate'
    expect(input.adoptedId).toBe('recreate');
    expect(input.candidates.map((c) => c.id).sort()).toEqual(['fallback', 'recreate', 'reuse']);
    expect(Object.keys(input.rejectedReasons).sort()).toEqual(['fallback', 'reuse']);
  });
});
