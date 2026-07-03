/**
 * ai-orchestra.test
 *
 * Covers AIOrchestra: state aggregation, task enqueue (including the session
 * bookkeeping + runner auto-start), sequential subtask enqueue for split
 * parents, plan-approval resume broadcast, and startup recovery.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockOrchestraSessionFindUnique = mock(() =>
  Promise.resolve<Record<string, unknown> | null>(null),
);
const mockOrchestraSessionUpdate = mock(() => Promise.resolve({}));
const mockOrchestraSessionFindFirst = mock(() =>
  Promise.resolve<Record<string, unknown> | null>(null),
);
const mockTaskFindMany = mock(() => Promise.resolve<Array<{ id: number }>>([]));
const mockTaskUpdate = mock(() => Promise.resolve({}));

mock.module('../../config', () => ({
  prisma: {
    orchestraSession: {
      findUnique: mockOrchestraSessionFindUnique,
      update: mockOrchestraSessionUpdate,
      findFirst: mockOrchestraSessionFindFirst,
    },
    task: { findMany: mockTaskFindMany, update: mockTaskUpdate },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => 'default',
  getProjectRoot: () => '/tmp/rapitas-test',
}));

const noopLog = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLog,
}));

const mockQueue = {
  getSessionItems: mock(() => Promise.resolve<Array<{ status: string }>>([])),
  getQueueState: mock(() =>
    Promise.resolve({ queued: [], running: [], waitingApproval: [], completed: [], failed: [] }),
  ),
  enqueue: mock((opts: { taskId: number }) => Promise.resolve({ id: opts.taskId })),
  recoverStaleItems: mock(() => Promise.resolve(0)),
  setMaxConcurrency: mock(() => {}),
};
mock.module('./workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => mockQueue },
}));

const mockRunner = {
  getStatus: mock(() => ({ isRunning: false, activeItems: 0, processedTotal: 0 })),
  startProcessing: mock(() => {}),
  resumeAfterApproval: mock(() => Promise.resolve(false)),
};
mock.module('./workflow-runner', () => ({
  WorkflowRunner: { getInstance: () => mockRunner },
}));

const mockBroadcast = mock(() => {});
mock.module('../communication/realtime-service', () => ({
  realtimeService: { broadcast: mockBroadcast },
}));

const mockSchedulerRecoverOnStartup = mock(() => Promise.resolve());
mock.module('./auto-run/theme-auto-run-scheduler', () => ({
  ThemeAutoRunScheduler: {
    getInstance: () => ({ recoverOnStartup: mockSchedulerRecoverOnStartup }),
  },
}));

const { AIOrchestra } = await import('./ai-orchestra');

function resetSingleton() {
  (AIOrchestra as unknown as { instance: unknown }).instance = undefined;
}

function resetMocks() {
  mockOrchestraSessionFindUnique.mockReset();
  mockOrchestraSessionFindUnique.mockResolvedValue(null);
  mockOrchestraSessionUpdate.mockReset();
  mockOrchestraSessionUpdate.mockResolvedValue({});
  mockOrchestraSessionFindFirst.mockReset();
  mockOrchestraSessionFindFirst.mockResolvedValue(null);
  mockTaskFindMany.mockReset();
  mockTaskFindMany.mockResolvedValue([]);
  mockTaskUpdate.mockReset();
  mockTaskUpdate.mockResolvedValue({});
  mockQueue.getSessionItems.mockReset();
  mockQueue.getSessionItems.mockResolvedValue([]);
  mockQueue.getQueueState.mockReset();
  mockQueue.getQueueState.mockResolvedValue({
    queued: [],
    running: [],
    waitingApproval: [],
    completed: [],
    failed: [],
  });
  mockQueue.enqueue.mockReset();
  mockQueue.enqueue.mockImplementation((opts: { taskId: number }) =>
    Promise.resolve({ id: opts.taskId }),
  );
  mockQueue.recoverStaleItems.mockReset();
  mockQueue.recoverStaleItems.mockResolvedValue(0);
  mockQueue.setMaxConcurrency.mockClear();
  mockRunner.getStatus.mockReset();
  mockRunner.getStatus.mockReturnValue({ isRunning: false, activeItems: 0, processedTotal: 0 });
  mockRunner.startProcessing.mockClear();
  mockRunner.resumeAfterApproval.mockReset();
  mockRunner.resumeAfterApproval.mockResolvedValue(false);
  mockBroadcast.mockClear();
  mockSchedulerRecoverOnStartup.mockReset();
  mockSchedulerRecoverOnStartup.mockResolvedValue(undefined);
  noopLog.info.mockClear();
  noopLog.warn.mockClear();
  resetSingleton();
}

describe('AIOrchestra.getState', () => {
  beforeEach(resetMocks);

  test('reports a null session when no session has ever been recovered/started', async () => {
    const orchestra = AIOrchestra.getInstance();
    const state = await orchestra.getState();
    expect(state.session).toBeNull();
    expect(mockOrchestraSessionFindUnique).not.toHaveBeenCalled();
  });

  test('computes completed/failed counts from the session queue items', async () => {
    mockOrchestraSessionFindFirst.mockResolvedValue({
      id: 9,
      status: 'conducting',
      maxConcurrency: 2,
    });
    const orchestra = AIOrchestra.getInstance();
    await orchestra.recoverOnStartup();

    mockOrchestraSessionFindUnique.mockResolvedValue({
      id: 9,
      status: 'conducting',
      totalTasks: 3,
      startedAt: new Date('2026-01-01T00:00:00Z'),
    });
    mockQueue.getSessionItems.mockResolvedValue([
      { status: 'completed' },
      { status: 'completed' },
      { status: 'failed' },
    ]);

    const state = await orchestra.getState();
    expect(state.session).toEqual(
      expect.objectContaining({ id: 9, completedTasks: 2, failedTasks: 1, totalTasks: 3 }),
    );
  });

  test('reports a null session when the session row disappeared (findUnique returns null)', async () => {
    mockOrchestraSessionFindFirst.mockResolvedValue({
      id: 9,
      status: 'conducting',
      maxConcurrency: 1,
    });
    const orchestra = AIOrchestra.getInstance();
    await orchestra.recoverOnStartup();
    mockOrchestraSessionFindUnique.mockResolvedValue(null);

    const state = await orchestra.getState();
    expect(state.session).toBeNull();
  });
});

describe('AIOrchestra.enqueueTask', () => {
  beforeEach(resetMocks);

  test('enqueues without touching session bookkeeping when no session is active', async () => {
    const orchestra = AIOrchestra.getInstance();
    const result = await orchestra.enqueueTask({ taskId: 1 });

    expect(result).toEqual({ success: true, itemId: 1 });
    expect(mockOrchestraSessionUpdate).not.toHaveBeenCalled();
    expect(mockRunner.startProcessing).toHaveBeenCalledTimes(1);
  });

  test('does not restart an already-running runner', async () => {
    mockRunner.getStatus.mockReturnValue({ isRunning: true, activeItems: 1, processedTotal: 5 });
    const orchestra = AIOrchestra.getInstance();
    await orchestra.enqueueTask({ taskId: 2 });
    expect(mockRunner.startProcessing).not.toHaveBeenCalled();
  });

  test('stamps the active session id and increments its task total', async () => {
    mockOrchestraSessionFindFirst.mockResolvedValue({
      id: 4,
      status: 'conducting',
      maxConcurrency: 1,
    });
    const orchestra = AIOrchestra.getInstance();
    await orchestra.recoverOnStartup();

    const options: { taskId: number; orchestraSessionId?: number } = { taskId: 3 };
    await orchestra.enqueueTask(options);

    expect(options.orchestraSessionId).toBe(4);
    expect(mockOrchestraSessionUpdate).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { totalTasks: { increment: 1 } },
    });
  });

  test('returns a structured failure when the queue rejects with an Error', async () => {
    mockQueue.enqueue.mockImplementation(() => Promise.reject(new Error('duplicate item')));
    const orchestra = AIOrchestra.getInstance();
    const result = await orchestra.enqueueTask({ taskId: 5 });
    expect(result).toEqual({ success: false, error: 'duplicate item' });
  });

  test('stringifies a non-Error rejection', async () => {
    mockQueue.enqueue.mockImplementation(() => Promise.reject('plain string failure'));
    const orchestra = AIOrchestra.getInstance();
    const result = await orchestra.enqueueTask({ taskId: 6 });
    expect(result).toEqual({ success: false, error: 'plain string failure' });
  });
});

describe('AIOrchestra.enqueueSubtasksForExecution', () => {
  beforeEach(resetMocks);

  test('returns 0 and never touches the parent when there are no pending subtasks', async () => {
    mockTaskFindMany.mockResolvedValue([]);
    const orchestra = AIOrchestra.getInstance();
    const count = await orchestra.enqueueSubtasksForExecution(100);
    expect(count).toBe(0);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  test('moves the parent to in_progress and enqueues every pending subtask in order', async () => {
    mockTaskFindMany.mockResolvedValue([{ id: 201 }, { id: 202 }]);
    const orchestra = AIOrchestra.getInstance();
    const count = await orchestra.enqueueSubtasksForExecution(100);

    expect(count).toBe(2);
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { workflowStatus: 'in_progress', status: 'in-progress' },
    });
    expect(mockQueue.enqueue).toHaveBeenCalledTimes(2);
  });

  test('a subtask whose enqueue fails is skipped without aborting the rest', async () => {
    mockTaskFindMany.mockResolvedValue([{ id: 301 }, { id: 302 }]);
    mockQueue.enqueue
      .mockImplementationOnce(() => Promise.reject(new Error('already queued')))
      .mockImplementationOnce((opts: { taskId: number }) => Promise.resolve({ id: opts.taskId }));

    const orchestra = AIOrchestra.getInstance();
    const count = await orchestra.enqueueSubtasksForExecution(100);

    expect(count).toBe(1);
  });

  test('a failure to flip the parent to in_progress does not block subtask enqueue', async () => {
    mockTaskFindMany.mockResolvedValue([{ id: 401 }]);
    mockTaskUpdate.mockRejectedValue(new Error('update failed'));

    const orchestra = AIOrchestra.getInstance();
    const count = await orchestra.enqueueSubtasksForExecution(100);

    expect(count).toBe(1);
    expect(noopLog.warn).toHaveBeenCalled();
  });
});

describe('AIOrchestra.handlePlanApproved', () => {
  beforeEach(resetMocks);

  test('broadcasts state when the runner actually resumed the task', async () => {
    mockRunner.resumeAfterApproval.mockResolvedValue(true);
    const orchestra = AIOrchestra.getInstance();
    await orchestra.handlePlanApproved(55);
    // broadcastState() is fire-and-forget (not awaited by handlePlanApproved) — flush microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockBroadcast).toHaveBeenCalledWith(
      'orchestra',
      'task_resumed',
      expect.objectContaining({ state: expect.anything() }),
    );
  });

  test('does not broadcast when the runner had nothing to resume', async () => {
    mockRunner.resumeAfterApproval.mockResolvedValue(false);
    const orchestra = AIOrchestra.getInstance();
    await orchestra.handlePlanApproved(55);
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  test('swallows a broadcast-time failure instead of propagating it', async () => {
    mockRunner.resumeAfterApproval.mockResolvedValue(true);
    mockQueue.getQueueState.mockRejectedValue(new Error('queue state unavailable'));
    const orchestra = AIOrchestra.getInstance();
    await expect(orchestra.handlePlanApproved(55)).resolves.toBeUndefined();
    // Flush the fire-and-forget broadcastState() so its rejection is caught, not left unhandled.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('AIOrchestra.recoverOnStartup', () => {
  beforeEach(resetMocks);

  test('leaves the runner idle and skips session restore when nothing was conducting', async () => {
    mockOrchestraSessionFindFirst.mockResolvedValue(null);
    const orchestra = AIOrchestra.getInstance();
    await orchestra.recoverOnStartup();

    expect(mockRunner.startProcessing).not.toHaveBeenCalled();
    expect(mockQueue.setMaxConcurrency).not.toHaveBeenCalled();
    expect(mockSchedulerRecoverOnStartup).toHaveBeenCalledTimes(1);
  });

  test('restores an in-flight session and resumes the runner', async () => {
    mockOrchestraSessionFindFirst.mockResolvedValue({
      id: 8,
      status: 'conducting',
      maxConcurrency: 3,
    });
    const orchestra = AIOrchestra.getInstance();
    await orchestra.recoverOnStartup();

    expect(mockQueue.setMaxConcurrency).toHaveBeenCalledWith(3);
    expect(mockRunner.startProcessing).toHaveBeenCalledTimes(1);
  });

  test('a failing theme-auto-run recovery does not fail the whole startup recovery', async () => {
    mockSchedulerRecoverOnStartup.mockRejectedValue(new Error('scheduler unavailable'));
    const orchestra = AIOrchestra.getInstance();
    await expect(orchestra.recoverOnStartup()).resolves.toBeUndefined();
    expect(noopLog.warn).toHaveBeenCalled();
  });
});

describe('AIOrchestra.getInstance', () => {
  beforeEach(resetMocks);

  test('returns the same instance across calls', () => {
    const a = AIOrchestra.getInstance();
    const b = AIOrchestra.getInstance();
    expect(a).toBe(b);
  });
});
