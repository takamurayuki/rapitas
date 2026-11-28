/**
 * workflow-orchestrator.parallel-recheck.not-enrolled.test
 *
 * Task 1572, G1: after auto-run lost a companion's slot (stopped, selection
 * undone), a self-driven advance (plan auto-approve's delayed advance,
 * resume-redispatch, a post-restart advance) must still not start the
 * implementer while the task's re-check mark is unconsumed. This runs the REAL
 * re-check gate inside WorkflowOrchestrator.advanceWorkflow, in standard
 * (plan_approved) and lightweight (research_done) mode.
 *
 * Run on its own: bun's mock.module is process-global.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
interface Row {
  taskId: number;
  cause: string;
  createdAt: Date;
  metadata: string;
}
let transitions: Row[] = [];
let taskThemeId: number | null;
let themeRow: { themeId: number; currentTaskId: number | null; companionTasksJson: string | null };
const mockPrisma = {
  calendarBusyBlock: { findMany: async () => [] },
  calendarSyncState: {
    findFirst: async () => null,
    update: async () => ({}),
    create: async () => ({}),
  },
  task: { findUnique: async () => ({ workflowStatus: 'plan_approved', workflowMode: null }) },
  workflowQueueItem: { findFirst: async () => ({ id: 11 }) },
  activityLog: { create: async () => ({}) },
  themeAutoRun: { findFirst: async () => themeRow },
  workflowTransition: {
    findMany: async (a: { where: { taskId: number; cause: { in: string[] } } }) =>
      transitions
        .filter((t) => t.taskId === a.where.taskId && a.where.cause.in.includes(t.cause))
        .slice(-1),
    findFirst: async () => null,
    create: async (a: { data: Omit<Row, 'createdAt'> }) => {
      transitions.push({ ...a.data, createdAt: new Date() });
      return {};
    },
  },
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
  getTaskExecutionLockOwner: () => Symbol.for('parallel-recheck-not-enrolled-lock'),
  DEFAULT_LOCK_TTL_MS: 30 * 60 * 1000,
  WORKFLOW_LOCK_TTL_MS: 30 * 60 * 1000,
  acquireTaskExecutionLock: mock(() => true),
  releaseTaskExecutionLock: mock(() => {}),
  isTaskExecutionLocked: mock(() => true),
}));

let preflight: { workflowMode: string; currentStatus: string };
mock.module('./workflow-orchestrator-preflight', () => ({
  runPreflight: mock(async () => ({
    done: false,
    task: {
      id: 7,
      themeId: taskThemeId,
      theme: taskThemeId === null ? null : { workingDirectory: null },
    },
    transition: { role: 'implementer', nextStatus: 'in_progress' },
    ...preflight,
  })),
}));
mock.module('./workflow-orchestrator-plan-guard', () => ({
  guardPlanValidity: mock(async () => ({ done: false })),
}));
mock.module('./workflow-orchestrator-protected-path-guard', () => ({
  PROTECTED_PATH_ESCALATION_CAUSE: 'protected_path_mode_escalated',
  plannedChangeSection: () => '',
  guardProtectedPathMode: mock(async () => ({ done: false })),
}));
// Reaching agent preparation means the implementer would start.
const prepMock = mock(async () => ({
  done: true,
  result: { success: false, role: 'implementer', status: 'plan_approved', error: 'reached' },
}));
mock.module('./workflow-orchestrator-agent-prep', () => ({ prepareAgentAndPrompt: prepMock }));
const executeMock = mock(async () => ({ success: true, role: 'implementer' }));
mock.module('./workflow-orchestrator-execute', () => ({ executeAgentWithFallback: executeMock }));

process.env.RAPITAS_IMPLEMENT_OVERLAP_HOLD = 'off';
process.env.RAPITAS_CALENDAR_GATE_ENABLED = 'false';

const { WorkflowOrchestrator } = await import('./workflow-orchestrator');
const { resetRecheckHoldState } = await import('./auto-run/parallel/recheck/recheck-state');

const MODES = [
  { name: 'standard', workflowMode: 'standard', currentStatus: 'plan_approved' },
  { name: 'lightweight', workflowMode: 'lightweight', currentStatus: 'research_done' },
  { name: 'comprehensive', workflowMode: 'comprehensive', currentStatus: 'plan_approved' },
];

for (const themeId of [1, null]) {
  describe('advanceWorkflow — unconsumed mark without a slot (G1)', () => {
    beforeEach(() => {
      taskThemeId = themeId;
      prepMock.mockClear();
      executeMock.mockClear();
      resetRecheckHoldState();
      transitions = [
        {
          taskId: 7,
          cause: 'parallel_recheck_pending',
          createdAt: new Date(1_000),
          metadata: '{}',
        },
      ];
      // Auto-run lost task 7's slot: only task 10 is running now.
      themeRow = { themeId: 1, currentTaskId: 10, companionTasksJson: null };
    });

    for (const m of MODES) {
      it(`${m.name} (${m.currentStatus}, themeId=${themeId}): 未消化印があると実装を起動しない`, async () => {
        preflight = { workflowMode: m.workflowMode, currentStatus: m.currentStatus };
        const r = await WorkflowOrchestrator.getInstance().advanceWorkflow(7, 'ja');
        expect(r.skipped).toBe(true);
        expect(r.held).toContain('not_enrolled');
        expect(r.status).toBe(m.currentStatus as never);
        expect(prepMock).not.toHaveBeenCalled();
        expect(executeMock).not.toHaveBeenCalled();
        const held = transitions.filter((t) => t.cause === 'parallel_recheck_held');
        expect(held.map((t) => JSON.parse(t.metadata).reason)).toEqual(['not_enrolled']);
      });

      it(`${m.name} (themeId=${themeId}): 印がなければ実装準備まで進む`, async () => {
        preflight = { workflowMode: m.workflowMode, currentStatus: m.currentStatus };
        transitions = [];
        const r = await WorkflowOrchestrator.getInstance().advanceWorkflow(7, 'ja');
        expect(prepMock).toHaveBeenCalledTimes(1);
        expect(r.error).toBe('reached');
      });
    }
  });
}
