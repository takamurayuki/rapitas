/**
 * workflow-orchestrator.calendar-guard.test
 *
 * AC3 (task 1174): WorkflowOrchestrator.advanceWorkflow — the single entry
 * every phase advance passes through (runner loop, post-phase setTimeout,
 * plan auto-approve) — returns `skipped + held` at the phase boundary while a
 * meeting is near, BEFORE any plan guard / agent preparation runs; the runner
 * then re-queues the item and the next phase starts after the meeting.
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const queueFindFirstMock = mock(async () => ({ id: 11 }) as { id: number } | null);
const activityCreateMock = mock(async () => ({}));
// calendar-store reads these two models through the (mocked) Prisma client.
let busyRows: Array<{ startAt: Date; endAt: Date }> = [];
let syncRow: { lastSyncedAt: Date; lastStatus: string; lastError: null } | null = null;
const mockPrisma = {
  calendarBusyBlock: { findMany: async () => busyRows },
  calendarSyncState: { findUnique: async () => syncRow },
  task: { findUnique: async () => ({ workflowStatus: 'plan_approved' }) },
  workflowQueueItem: { findFirst: queueFindFirstMock },
  activityLog: { create: activityCreateMock },
};

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../config', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
  logger: noopLogger,
  createLogger: () => noopLogger,
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => ({}),
  getProjectRoot: () => '/tmp/rapitas-test',
}));
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../agents/task-execution-lock', () => ({
  getTaskExecutionCancellationVersion: () => 0,
  getTaskExecutionLockOwner: () => Symbol.for('calendar-guard-test-lock'),
  DEFAULT_LOCK_TTL_MS: 30 * 60 * 1000,
  WORKFLOW_LOCK_TTL_MS: 30 * 60 * 1000,
  acquireTaskExecutionLock: mock(() => true),
  releaseTaskExecutionLock: mock(() => {}),
  isTaskExecutionLocked: mock(() => true),
}));
mock.module('./workflow-orchestrator-preflight', () => ({
  runPreflight: mock(async () => ({
    done: false,
    task: { id: 7, themeId: 1, theme: { workingDirectory: '/tmp' } },
    workflowMode: 'standard',
    currentStatus: 'plan_approved',
    transition: { role: 'implementer', nextStatus: 'in_progress' },
  })),
}));
// Reaching the plan guard means the calendar hold did not stop the advance.
const planGuardMock = mock(async () => ({
  done: true,
  result: { success: false, role: 'implementer', status: 'plan_approved', error: 'reached' },
}));
mock.module('./workflow-orchestrator-plan-guard', () => ({ guardPlanValidity: planGuardMock }));

const { WorkflowOrchestrator } = await import('./workflow-orchestrator');
const { resetCalendarHoldState } = await import('../scheduling/calendar-slot/calendar-hold-state');

describe('WorkflowOrchestrator.advanceWorkflow — calendar phase-boundary hold', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    resetCalendarHoldState();
    planGuardMock.mockClear();
    activityCreateMock.mockClear();
    process.env.RAPITAS_CALENDAR_GATE_ENABLED = 'true';
    process.env.RAPITAS_CALENDAR_LEAD_MINUTES = '10';
    process.env.RAPITAS_CALENDAR_POLL_MINUTES = '5';
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('stops before the next phase while a meeting is within the lead window', async () => {
    const now = Date.now();
    // Meeting starts in 5 min (inside the 10-min lead window).
    busyRows = [{ startAt: new Date(now + 5 * 60_000), endAt: new Date(now + 65 * 60_000) }];
    syncRow = { lastSyncedAt: new Date(now), lastStatus: 'ok', lastError: null };

    const r = await WorkflowOrchestrator.getInstance().advanceWorkflow(7, 'ja');

    expect(r.skipped).toBe(true);
    expect(r.held).toContain('calendar');
    expect(r.status).toBe('plan_approved');
    expect(planGuardMock).not.toHaveBeenCalled();
  });

  it('proceeds to the next phase in free time', async () => {
    const now = Date.now();
    busyRows = [{ startAt: new Date(now + 120 * 60_000), endAt: new Date(now + 180 * 60_000) }];
    syncRow = { lastSyncedAt: new Date(now), lastStatus: 'ok', lastError: null };

    const r = await WorkflowOrchestrator.getInstance().advanceWorkflow(7, 'ja');

    expect(planGuardMock).toHaveBeenCalledTimes(1);
    expect(r.error).toBe('reached');
  });
});
