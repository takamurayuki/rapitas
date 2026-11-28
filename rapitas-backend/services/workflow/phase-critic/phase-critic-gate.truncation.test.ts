/**
 * phase-critic-gate.truncation テスト
 *
 * A plan pass downgraded to 'unknown' by input truncation must go back to the
 * planner when it carries reasons (task 1593), and only then.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PhaseCritiqueResult } from './phase-critic-types';

const mockPrisma = {
  workflowTransition: {
    count: mock(() => Promise.resolve(0)),
    findFirst: mock(() => Promise.resolve(null)),
  },
  task: {
    updateMany: mock(() => Promise.resolve({ count: 1 })),
    findUnique: mock(() => Promise.resolve(null)),
  },
  workflowFile: { findFirst: mock(() => Promise.resolve(null)) },
};
type Recorded = {
  cause: string;
  metadata: Record<string, unknown>;
  invariantMessage?: string;
};
const recordTransition = mock((_input: Recorded) => Promise.resolve());
const archiveWorkflowFile = mock(() => Promise.resolve(true));
const scheduleWorkflowRedispatch = mock(() => {});
let verdict: PhaseCritiqueResult;

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('../../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../transition-recorder', () => ({ recordTransition }));
mock.module('../workflow-file-utils', () => ({ archiveWorkflowFile }));
mock.module('./phase-critic', () => ({
  critiquePhase: () => Promise.resolve(verdict),
  isPhaseCriticEnabled: () => true,
}));
mock.module('../workflow-redispatch', () => ({
  REDISPATCH_DELAY_MS: 1000,
  scheduleWorkflowRedispatch,
}));

const { applyPhaseCriticGate } = await import('./phase-critic-gate');

const downgraded: PhaseCritiqueResult = {
  verdict: 'unknown',
  severity: 30,
  reasons: ['[scope] 枠にいないと門を素通りする'],
  inputTruncated: true,
  downgradedByTruncation: true,
  evaluationComplete: true,
};

const run = (phase: 'plan' | 'research' = 'plan') =>
  applyPhaseCriticGate({
    taskId: 1593,
    phase,
    content: 'long plan',
    currentStatus: phase === 'plan' ? 'plan_created' : 'research_done',
  });

const recorded = (cause: string) =>
  recordTransition.mock.calls.map((c) => c[0]).find((r) => r.cause === cause);

beforeEach(() => {
  verdict = downgraded;
  mockPrisma.workflowTransition.count.mockReset().mockResolvedValue(0);
  mockPrisma.task.updateMany.mockReset().mockResolvedValue({ count: 1 });
  recordTransition.mockClear();
  archiveWorkflowFile.mockClear();
  scheduleWorkflowRedispatch.mockClear();
});

describe('applyPhaseCriticGate — truncation-downgraded plan pass', () => {
  test('returns the plan to the planner when it carries reasons', async () => {
    const result = await run();

    expect(result).toMatchObject({
      bounced: true,
      newStatus: 'research_done',
      reasons: downgraded.reasons,
    });
    expect(archiveWorkflowFile).toHaveBeenCalledWith(1593, 'plan');
    expect(scheduleWorkflowRedispatch).toHaveBeenCalledWith(1593, 'plan_critic_failed', 'ja');
    expect(recorded('plan_critic_failed')?.metadata).toMatchObject({
      returnedFromTruncation: true,
      inputTruncated: true,
      reasons: downgraded.reasons,
    });
    expect(recorded('plan_critic_failed')?.invariantMessage).toContain('判定不能');
    expect(recorded('plan_critic_incomplete')?.metadata).toMatchObject({
      downgradedByTruncation: true,
    });
  });

  test('proceeds when there are no reasons', async () => {
    verdict = { ...downgraded, reasons: [] };
    expect(await run()).toEqual({ bounced: false });
    expect(mockPrisma.task.updateMany).not.toHaveBeenCalled();
    expect(recorded('plan_critic_incomplete')?.metadata).toMatchObject({
      downgradedByTruncation: true,
    });
  });

  test('records plan_critic_exhausted and proceeds once the budget is used', async () => {
    mockPrisma.workflowTransition.count.mockResolvedValue(1);
    expect(await run()).toEqual({ bounced: false });
    expect(recorded('plan_critic_exhausted')?.metadata).toMatchObject({
      returnedFromTruncation: true,
    });
    expect(mockPrisma.task.updateMany).not.toHaveBeenCalled();
  });

  test('does not bounce an unknown that was not caused by truncation', async () => {
    verdict = {
      verdict: 'unknown',
      severity: 0,
      reasons: ['Required critique context could not be loaded'],
      inputTruncated: false,
      evaluationComplete: false,
    };
    expect(await run()).toEqual({ bounced: false });
    expect(mockPrisma.task.updateMany).not.toHaveBeenCalled();
    expect(recorded('plan_critic_incomplete')?.metadata).toMatchObject({
      downgradedByTruncation: false,
    });
  });

  test('leaves the research phase unchanged', async () => {
    expect(await run('research')).toEqual({ bounced: false });
    expect(mockPrisma.task.updateMany).not.toHaveBeenCalled();
  });

  test('does not record a return when the workflow already moved on', async () => {
    mockPrisma.task.updateMany.mockResolvedValue({ count: 0 });
    expect(await run()).toEqual({ bounced: false });
    expect(recorded('plan_critic_failed')).toBeUndefined();
    expect(archiveWorkflowFile).not.toHaveBeenCalled();
  });

  test('marks an ordinary fail as not returned from truncation', async () => {
    verdict = { verdict: 'fail', severity: 90, reasons: ['x'], inputTruncated: false };
    expect((await run()).bounced).toBe(true);
    expect(recorded('plan_critic_failed')?.metadata).toMatchObject({
      returnedFromTruncation: false,
    });
  });
});
