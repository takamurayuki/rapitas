/**
 * verify-invariant-repair.test
 *
 * Task 755 — checkWorkflowInvariants violations were logged on every
 * `file_saved:verify` transition but never fed into the repair loop, so the
 * identical violation code could recur cycle after cycle unnoticed (task
 * #572). Covers attemptInvariantCutoff: a first-time violation is a no-op, a
 * RECURRING violation code cuts the loop off (escalate + terminal
 * transition), and an unidentifiable window fails open.
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: mock(() => {}), error: () => {}, debug: () => {} };

const mockPrisma = {
  task: {
    findUnique: mock(() => Promise.resolve<{ title?: string; themeId?: number } | null>(null)),
  },
  workflowTransition: {
    findMany: mock(() => Promise.resolve([] as { invariantMessage: string | null }[])),
  },
};
const mockCheckWorkflowInvariants = mock(() =>
  Promise.resolve([] as { code: string; message: string }[]),
);
const mockRecordTransition = mock(() => Promise.resolve());
const mockEscalateBlockedTask = mock(() => Promise.resolve(true));

mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('./transition-recorder', () => ({ recordTransition: mockRecordTransition }));
mock.module('./workflow-invariants', () => ({
  checkWorkflowInvariants: mockCheckWorkflowInvariants,
}));
mock.module('./blocked-task-escalation', () => ({
  escalateBlockedTask: mockEscalateBlockedTask,
  BLOCKED_ESCALATED_CAUSE: 'blocked_escalated',
  countEscalatedBlocked: () => Promise.resolve(0),
}));

const { attemptInvariantCutoff, INVARIANT_NON_CONVERGENCE_CAUSE } =
  await import('./verify-invariant-repair');

describe('attemptInvariantCutoff', () => {
  beforeEach(() => {
    mockPrisma.task.findUnique.mockReset().mockResolvedValue({ title: 'T', themeId: 1 });
    mockPrisma.workflowTransition.findMany.mockReset().mockResolvedValue([]);
    mockCheckWorkflowInvariants.mockReset().mockResolvedValue([]);
    mockRecordTransition.mockReset().mockResolvedValue(undefined);
    mockEscalateBlockedTask.mockReset().mockResolvedValue(true);
  });

  test('no violations → false, no transition recorded', async () => {
    const result = await attemptInvariantCutoff(700, 'in_progress', 'reason', null);
    expect(result).toBe(false);
    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(mockEscalateBlockedTask).not.toHaveBeenCalled();
  });

  test('first-time violation (no prior matching row) → false, task not newly blocked', async () => {
    mockCheckWorkflowInvariants.mockResolvedValue([
      { code: 'status_mismatch', message: 'workflowStatus="completed" but task.status="todo"' },
    ]);
    mockPrisma.workflowTransition.findMany.mockResolvedValue([]);
    const result = await attemptInvariantCutoff(700, 'verify_done', 'reason', null);
    expect(result).toBe(false);
    expect(mockRecordTransition).not.toHaveBeenCalled();
  });

  test('recurring violation code (task #572 shape) → true, cutoff transition recorded', async () => {
    mockCheckWorkflowInvariants.mockResolvedValue([
      { code: 'incomplete_subtasks', message: 'workflowStatus="verify_done" but 1 subtask(s)...' },
    ]);
    mockPrisma.workflowTransition.findMany.mockResolvedValue([
      { invariantMessage: 'incomplete_subtasks:workflowStatus="verify_done" but 1 subtask(s)...' },
    ]);
    const result = await attemptInvariantCutoff(572, 'verify_done', 'reason', null);
    expect(result).toBe(true);
    expect(mockEscalateBlockedTask).toHaveBeenCalledTimes(1);
    expect(mockRecordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 572,
        cause: INVARIANT_NON_CONVERGENCE_CAUSE,
        invariantViolation: true,
        metadata: expect.objectContaining({ recurredCodes: ['incomplete_subtasks'] }),
      }),
    );
  });

  test('different violation codes across cycles do not recur → false', async () => {
    mockCheckWorkflowInvariants.mockResolvedValue([{ code: 'missing_file', message: 'x' }]);
    mockPrisma.workflowTransition.findMany.mockResolvedValue([
      { invariantMessage: 'status_mismatch:some other message' },
    ]);
    const result = await attemptInvariantCutoff(700, 'verify_done', 'reason', null);
    expect(result).toBe(false);
    expect(mockRecordTransition).not.toHaveBeenCalled();
  });

  test('checkWorkflowInvariants throwing fails open (no cutoff)', async () => {
    mockCheckWorkflowInvariants.mockImplementation(() => Promise.reject(new Error('db down')));
    const result = await attemptInvariantCutoff(700, 'verify_done', 'reason', null);
    expect(result).toBe(false);
    expect(mockRecordTransition).not.toHaveBeenCalled();
  });

  test('workflowTransition.findMany throwing fails open (no cutoff)', async () => {
    mockCheckWorkflowInvariants.mockResolvedValue([{ code: 'missing_file', message: 'x' }]);
    mockPrisma.workflowTransition.findMany.mockImplementation(() =>
      Promise.reject(new Error('db down')),
    );
    const result = await attemptInvariantCutoff(700, 'verify_done', 'reason', null);
    expect(result).toBe(false);
  });
});
