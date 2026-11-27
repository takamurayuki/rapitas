/**
 * workflow-orchestrator.parallel-recheck.test
 *
 * Task 1572: every implementer start passes the parallel re-check stage of
 * WorkflowOrchestrator.advanceWorkflow, in standard mode (plan_approved →
 * implementer) and in lightweight mode (research_done → implementer, no plan
 * phase). While the gate holds, no agent preparation (and so no implementer)
 * runs; once it passes, the implementer is prepared.
 *
 * Run on its own: bun's mock.module is process-global.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const mockPrisma = {
  calendarBusyBlock: { findMany: async () => [] },
  calendarSyncState: {
    findFirst: async () => null,
    update: async () => ({}),
    create: async () => ({}),
  },
  task: { findUnique: async () => ({ workflowStatus: 'plan_approved' }) },
  workflowQueueItem: { findFirst: async () => ({ id: 11 }) },
  activityLog: { create: async () => ({}) },
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
  getTaskExecutionLockOwner: () => Symbol.for('parallel-recheck-test-lock'),
  DEFAULT_LOCK_TTL_MS: 30 * 60 * 1000,
  WORKFLOW_LOCK_TTL_MS: 30 * 60 * 1000,
  acquireTaskExecutionLock: mock(() => true),
  releaseTaskExecutionLock: mock(() => {}),
  isTaskExecutionLocked: mock(() => true),
}));

let preflight: {
  workflowMode: string;
  currentStatus: string;
  transition: { role: string; nextStatus: string };
};
mock.module('./workflow-orchestrator-preflight', () => ({
  runPreflight: mock(async () => ({
    done: false,
    task: { id: 7, themeId: 1, theme: { workingDirectory: '/tmp' } },
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

let gateHolds = true;
const gateMock = mock(async (_taskId: number, transition: { role: string }, ...rest: unknown[]) => {
  void rest;
  return gateHolds
    ? {
        done: true,
        result: {
          success: true,
          skipped: true,
          role: transition.role,
          status: preflight.currentStatus,
          held: 'parallel re-check waits on task 10 (file_overlap)',
        },
      }
    : { done: false };
});
mock.module('./auto-run/parallel/recheck/recheck-gate', () => ({ guardParallelRecheck: gateMock }));

// Reaching agent preparation means the implementer would start.
const prepMock = mock(async () => ({
  done: true,
  result: { success: false, role: 'implementer', status: 'plan_approved', error: 'reached' },
}));
mock.module('./workflow-orchestrator-agent-prep', () => ({ prepareAgentAndPrompt: prepMock }));

process.env.RAPITAS_IMPLEMENT_OVERLAP_HOLD = 'off';
process.env.RAPITAS_CALENDAR_GATE_ENABLED = 'false';

const { WorkflowOrchestrator } = await import('./workflow-orchestrator');

const MODES = [
  { name: 'standard', workflowMode: 'standard', currentStatus: 'plan_approved' },
  { name: 'comprehensive', workflowMode: 'comprehensive', currentStatus: 'plan_approved' },
  { name: 'lightweight', workflowMode: 'lightweight', currentStatus: 'research_done' },
];

describe('WorkflowOrchestrator.advanceWorkflow — parallel re-check stage', () => {
  beforeEach(() => {
    gateMock.mockClear();
    prepMock.mockClear();
  });

  for (const m of MODES) {
    describe(`${m.name} (${m.currentStatus} → implementer)`, () => {
      beforeEach(() => {
        preflight = {
          workflowMode: m.workflowMode,
          currentStatus: m.currentStatus,
          transition: { role: 'implementer', nextStatus: 'in_progress' },
        };
      });

      it('does not prepare the implementer while the re-check holds', async () => {
        gateHolds = true;
        const r = await WorkflowOrchestrator.getInstance().advanceWorkflow(7, 'ja');
        expect(r.skipped).toBe(true);
        expect(r.held).toContain('parallel re-check');
        expect(r.status).toBe(m.currentStatus as never);
        expect(prepMock).not.toHaveBeenCalled();
        expect(gateMock).toHaveBeenCalledTimes(1);
        const args = gateMock.mock.calls[0]!;
        expect(args[0]).toBe(7);
        expect(args[1]).toMatchObject({ role: 'implementer' });
        expect(args.slice(2)).toEqual([
          expect.objectContaining({ themeId: 1 }),
          m.currentStatus,
          m.workflowMode,
        ]);
      });

      it('prepares the implementer once the re-check passes', async () => {
        gateHolds = false;
        const r = await WorkflowOrchestrator.getInstance().advanceWorkflow(7, 'ja');
        expect(gateMock).toHaveBeenCalledTimes(1);
        expect(prepMock).toHaveBeenCalledTimes(1);
        expect(r.error).toBe('reached');
      });
    });
  }
});
