/**
 * plan-auto-approve.critic-inflight テスト
 *
 * The save handler stops waiting for the plan critique after 90s. Auto-approval
 * must hold until that critique settles, or its late bounce is discarded
 * (task 1593). Uses the real in-flight registry.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { registerCritique } from './phase-critic/critic-inflight';

mock.module('./workflow-orchestrator', () => ({
  WorkflowOrchestrator: { getInstance: () => ({ advanceWorkflow: async () => ({}) }) },
}));
mock.module('./plan-approval-queue-sync', () => ({
  syncAfterPlanApprovalAndNotifyTheme: async () => ({ released: 0 }),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

let workflowStatus = 'plan_created';
const updateMany = mock(async () => {
  if (workflowStatus !== 'plan_created') return { count: 0 };
  workflowStatus = 'plan_approved';
  return { count: 1 };
});

mock.module('../../config/database', () => ({
  prisma: {
    workflowTransition: { findFirst: async () => null },
    userSettings: { findFirst: async () => ({ autoApprovePlan: true }) },
    task: {
      findUnique: async () => ({
        autoApprovePlan: false,
        parentId: null,
        workflowStatus,
        status: 'in-progress',
        updatedAt: new Date(0),
      }),
      updateMany,
    },
    activityLog: { create: async () => ({}) },
  },
}));
mock.module('./transition-recorder', () => ({ recordTransition: async () => {} }));

// Imported after the mocks: both modules reach config/database.
const { maybeAutoApprovePlan } = await import('./plan-auto-approve');
const { releaseTaskExecutionLock } = await import('../agents/task-execution-lock');

/** Registers a critique that stays in flight until the returned function is called. */
function startCritique(taskId: number): () => void {
  let settle!: () => void;
  registerCritique(taskId, new Promise<void>((resolve) => (settle = resolve)));
  return settle;
}

/** Lets the deferred re-run of auto-approval finish. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

// NOTE: autoAdvance defaults to true; the 1s advance timer targets the mocked orchestrator.
beforeEach(() => {
  workflowStatus = 'plan_created';
  updateMany.mockClear();
});

describe('maybeAutoApprovePlan — plan critique still in flight', () => {
  test('holds without updating the task', async () => {
    const settle = startCritique(1);
    expect(await maybeAutoApprovePlan(1)).toEqual({
      newStatus: 'plan_created',
      autoApproved: false,
    });
    expect(updateMany).not.toHaveBeenCalled();
    workflowStatus = 'research_done';
    settle();
    await flush();
  });

  test('approves once after the critique settles with a pass, even with two waiters', async () => {
    const settle = startCritique(2);
    await maybeAutoApprovePlan(2);
    await maybeAutoApprovePlan(2);
    settle();
    await flush();
    expect(workflowStatus).toBe('plan_approved');
    // Both waiters may reach the compare-and-swap; only one of them wins it.
    const results = await Promise.all(updateMany.mock.results.map((r) => r.value));
    expect(results.filter((r) => r.count === 1)).toHaveLength(1);
  });

  test('does not approve a plan the late verdict bounced', async () => {
    const settle = startCritique(3);
    await maybeAutoApprovePlan(3);
    workflowStatus = 'research_done';
    settle();
    await flush();
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('does not approve after a stop', async () => {
    const settle = startCritique(4);
    await maybeAutoApprovePlan(4);
    releaseTaskExecutionLock(4);
    settle();
    await flush();
    expect(updateMany).not.toHaveBeenCalled();
    expect(workflowStatus).toBe('plan_created');
  });

  test('holds a subtask split too, then runs onHeldApproval once after the pass', async () => {
    const settle = startCritique(5);
    const onHeldApproval = mock(async () => {});
    const opts = { autoAdvance: false, onHeldApproval };
    expect((await maybeAutoApprovePlan(5, 'ja', opts)).autoApproved).toBe(false);
    await maybeAutoApprovePlan(5, 'ja', opts);
    expect(updateMany).not.toHaveBeenCalled();
    settle();
    await flush();
    expect(workflowStatus).toBe('plan_approved');
    expect(onHeldApproval).toHaveBeenCalledTimes(1);
  });

  test('does not run onHeldApproval when the late verdict bounced the plan', async () => {
    const settle = startCritique(6);
    const onHeldApproval = mock(async () => {});
    await maybeAutoApprovePlan(6, 'ja', { autoAdvance: false, onHeldApproval });
    workflowStatus = 'research_done';
    settle();
    await flush();
    expect(onHeldApproval).not.toHaveBeenCalled();
  });

  test('does not run onHeldApproval for an approval that was never held', async () => {
    const onHeldApproval = mock(async () => {});
    expect((await maybeAutoApprovePlan(7, 'ja', { onHeldApproval })).autoApproved).toBe(true);
    await flush();
    expect(onHeldApproval).not.toHaveBeenCalled();
  });

  test('survives a failing onHeldApproval', async () => {
    const settle = startCritique(8);
    const onHeldApproval = mock(async () => {
      throw new Error('enqueue failed');
    });
    await maybeAutoApprovePlan(8, 'ja', { autoAdvance: false, onHeldApproval });
    settle();
    await flush();
    expect(onHeldApproval).toHaveBeenCalledTimes(1);
    expect(workflowStatus).toBe('plan_approved');
  });
});
