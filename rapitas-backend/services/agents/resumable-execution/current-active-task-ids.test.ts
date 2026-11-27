import { describe, it, expect, mock } from 'bun:test';

const mockPrisma = {
  agentExecution: {
    findMany: mock(() => Promise.resolve([])),
  },
};

const mockOrchestrator = {
  getActiveExecutionIdsAsync: mock(() => Promise.resolve([1, 2])),
  getActiveExecutions: mock(() => []),
};

mock.module('../../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../core/orchestrator-instance', () => ({ orchestrator: mockOrchestrator }));
mock.module('../agent-orchestrator', () => ({
  AgentOrchestrator: {
    getInstance: () => ({
      getActiveAgentInfos: () => [{ executionId: 2 }, { executionId: 3 }],
    }),
  },
}));

// Task ids the workflow runner has registered (restart observation, task 1562).
let runnerTaskIds: number[] = [];
mock.module('../../workflow/workflow-runner', () => ({
  WorkflowRunner: { getInstance: () => ({ getActiveTaskIds: () => runnerTaskIds }) },
}));

const { getCurrentActiveExecutionIds, getLiveTaskIdsForActiveExecutions } =
  await import('./current-active-task-ids');
const { registerExecution } =
  await import('../../scheduling/auto-restart-merged-code/execution-ledger');

describe('getCurrentActiveExecutionIds', () => {
  it('台帳だけに登録された直接advanceも再起動判定に含める', async () => {
    runnerTaskIds = [];
    mockPrisma.agentExecution.findMany = mock(() => Promise.resolve([]));
    const release = registerExecution(72);
    try {
      expect(await getCurrentActiveExecutionIds()).toEqual([1, 2, 3, -72]);
    } finally {
      release();
    }
  });

  it('DB・runner・台帳が同じ実行を観測しても重複させない', async () => {
    runnerTaskIds = [72];
    mockPrisma.agentExecution.findMany = mock(() =>
      Promise.resolve([{ session: { config: { task: { id: 72 } } } }]),
    );
    const release = registerExecution(72);
    try {
      expect(await getCurrentActiveExecutionIds()).toEqual([1, 2, 3]);
    } finally {
      release();
      runnerTaskIds = [];
    }
  });
  it('unions worker and main-orchestrator active execution IDs without duplicates', async () => {
    const ids = await getCurrentActiveExecutionIds();
    expect(new Set(ids)).toEqual(new Set([1, 2, 3]));
  });
});

describe('getCurrentActiveExecutionIds — runner registrations', () => {
  it('an item registered by the runner before its agent has an execution row is observed', async () => {
    runnerTaskIds = [70];
    mockPrisma.agentExecution.findMany = mock(() => Promise.resolve([]));
    const ids = await getCurrentActiveExecutionIds();
    expect(ids.length).toBe(4); // 1, 2, 3 + one runner-only entry
    expect(ids.filter((id) => id < 0)).toEqual([-70]);
  });

  it('a task covered by both the runner and a live execution is observed once', async () => {
    runnerTaskIds = [70, 70];
    mockPrisma.agentExecution.findMany = mock(() =>
      Promise.resolve([{ session: { config: { task: { id: 70 } } } }]),
    );
    const ids = await getCurrentActiveExecutionIds();
    expect(ids.filter((id) => id < 0)).toEqual([]);
    expect(new Set(ids)).toEqual(new Set([1, 2, 3]));
  });

  it('a runner-only task registered twice is observed once', async () => {
    runnerTaskIds = [71, 71];
    mockPrisma.agentExecution.findMany = mock(() => Promise.resolve([]));
    const ids = await getCurrentActiveExecutionIds();
    expect(ids.filter((id) => id < 0)).toEqual([-71]);
  });

  it('adds nothing when the runner has no registrations', async () => {
    runnerTaskIds = [];
    const ids = await getCurrentActiveExecutionIds();
    expect(new Set(ids)).toEqual(new Set([1, 2, 3]));
  });
});

describe('getLiveTaskIdsForActiveExecutions', () => {
  it('returns an empty set without querying the DB when given no active IDs', async () => {
    mockPrisma.agentExecution.findMany.mockClear();
    const result = await getLiveTaskIdsForActiveExecutions([]);
    expect(result).toEqual(new Set());
    expect(mockPrisma.agentExecution.findMany).not.toHaveBeenCalled();
  });

  it('queries running/waiting_for_input executions restricted to the given IDs', async () => {
    mockPrisma.agentExecution.findMany.mockClear();
    mockPrisma.agentExecution.findMany = mock(() =>
      Promise.resolve([
        { session: { config: { task: { id: 42 } } } },
        { session: { config: { task: { id: 42 } } } },
      ]),
    );
    const result = await getLiveTaskIdsForActiveExecutions([10, 11]);
    expect(result).toEqual(new Set([42]));
    const callArgs = mockPrisma.agentExecution.findMany.mock.calls[0][0];
    expect(callArgs.where.id.in).toEqual([10, 11]);
    expect(callArgs.where.status.in).toEqual(['running', 'waiting_for_input']);
  });

  it('ignores rows whose task ID cannot be resolved', async () => {
    mockPrisma.agentExecution.findMany = mock(() =>
      Promise.resolve([{ session: { config: { task: null } } }]),
    );
    const result = await getLiveTaskIdsForActiveExecutions([99]);
    expect(result).toEqual(new Set());
  });
});
