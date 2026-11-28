/**
 * workflow-runner.plan-approval.test
 *
 * The 'plan_created' branch of WorkflowRunner: the auto-approve precedence
 * (task-level > user-level > per-subtask), the wait-for-approval path, the hold
 * while a plan critique runs, and the iteration budget around that branch.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  WorkflowRunner,
  QUEUE_ITEM,
  fixtures,
  state,
  runAndSettle,
  startItem,
  settleItem,
  resetMocks,
  resetRunner,
  queueMock,
  updateStatusMock,
  taskUpdateManyMock,
  resolveTaskWorkflowStateMock,
  broadcastItemUpdateCalls,
} from './workflow-runner.phases.test-support';
import { registerCritique } from './phase-critic/critic-inflight';

/** Runs one pass with an iteration budget of 1. */
async function runWithBudgetOfOne(): Promise<void> {
  const previous = process.env.RAPITAS_RUNNER_MAX_ITERATIONS;
  process.env.RAPITAS_RUNNER_MAX_ITERATIONS = '1';
  try {
    await runAndSettle(WorkflowRunner.getInstance());
  } finally {
    if (previous === undefined) delete process.env.RAPITAS_RUNNER_MAX_ITERATIONS;
    else process.env.RAPITAS_RUNNER_MAX_ITERATIONS = previous;
  }
}

describe('WorkflowRunner — plan_created auto-approve', () => {
  beforeEach(() => {
    resetMocks();
    resetRunner();
  });

  test('task-level autoApprovePlan advances without waiting', async () => {
    fixtures.planApproval = { id: QUEUE_ITEM.taskId, autoApprovePlan: true, parentId: null };
    fixtures.states = [
      state({ workflowStatus: 'plan_created' }),
      state({ workflowStatus: 'completed', status: 'done' }),
    ];
    await runAndSettle(WorkflowRunner.getInstance());

    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: { id: QUEUE_ITEM.taskId, workflowStatus: 'plan_created' },
      data: { workflowStatus: 'plan_approved', status: 'in-progress' },
    });
    expect(broadcastItemUpdateCalls).toContainEqual({
      event: 'phase_completed',
      phase: 'plan_created',
    });
  });

  test('user-level autoApprovePlan advances when the task flag is unset', async () => {
    fixtures.planApproval = { id: QUEUE_ITEM.taskId, autoApprovePlan: false, parentId: null };
    fixtures.userSettings = { autoApprovePlan: true };
    fixtures.states = [
      state({ workflowStatus: 'plan_created' }),
      state({ workflowStatus: 'completed', status: 'done' }),
    ];
    await runAndSettle(WorkflowRunner.getInstance());

    expect(taskUpdateManyMock).toHaveBeenCalledTimes(1);
  });

  test('per-subtask autoApproveSubtaskPlan advances a subtask when other flags are off', async () => {
    fixtures.planApproval = { id: QUEUE_ITEM.taskId, autoApprovePlan: false, parentId: 99 };
    fixtures.userSettings = { autoApprovePlan: false, autoApproveSubtaskPlan: true };
    fixtures.states = [
      state({ workflowStatus: 'plan_created', parentId: 99 }),
      state({ workflowStatus: 'completed', status: 'done', parentId: 99 }),
    ];
    await runAndSettle(WorkflowRunner.getInstance());

    expect(taskUpdateManyMock).toHaveBeenCalledTimes(1);
  });

  test('does not approve while the plan critique is in flight', async () => {
    let settle!: () => void;
    registerCritique(QUEUE_ITEM.taskId, new Promise<void>((resolve) => (settle = resolve)));
    fixtures.planApproval = { id: QUEUE_ITEM.taskId, autoApprovePlan: true, parentId: null };
    // The late verdict bounces the plan, so the re-read no longer sees plan_created.
    fixtures.states = [
      state({ workflowStatus: 'plan_created' }),
      state({ workflowStatus: 'completed', status: 'done' }),
    ];
    const runner = WorkflowRunner.getInstance();
    startItem(runner);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(taskUpdateManyMock).not.toHaveBeenCalled();

    settle();
    await settleItem(runner);
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
    expect(resolveTaskWorkflowStateMock).toHaveBeenCalledTimes(2);
  });

  test('no auto-approve flag set waits for manual approval', async () => {
    fixtures.planApproval = { id: QUEUE_ITEM.taskId, autoApprovePlan: false, parentId: null };
    fixtures.userSettings = { autoApprovePlan: false };
    fixtures.states = [state({ workflowStatus: 'plan_created' })];
    await runAndSettle(WorkflowRunner.getInstance());

    expect(taskUpdateManyMock).not.toHaveBeenCalled();
    expect(updateStatusMock).toHaveBeenCalledWith(QUEUE_ITEM.id, 'waiting_approval', {
      currentPhase: 'plan_created',
    });
    expect(broadcastItemUpdateCalls).toContainEqual({
      event: 'waiting_approval',
      phase: 'plan_created',
    });
    // Only one resolveTaskWorkflowState read should occur — the loop must stop, not spin.
    expect(resolveTaskWorkflowStateMock).toHaveBeenCalledTimes(1);
  });
});

describe('WorkflowRunner — iteration budget', () => {
  beforeEach(() => {
    resetMocks();
    resetRunner();
  });

  test('an item finished on the last allowed iteration is not failed as budget-exhausted', async () => {
    fixtures.states = [state({ workflowStatus: 'completed', status: 'done' })];
    await runWithBudgetOfOne();

    expect(updateStatusMock).toHaveBeenCalledWith(
      QUEUE_ITEM.id,
      'completed',
      expect.objectContaining({ currentPhase: 'completed' }),
    );
    expect(queueMock.retryIfPossible).not.toHaveBeenCalled();
    expect(updateStatusMock).not.toHaveBeenCalledWith(QUEUE_ITEM.id, 'failed', expect.anything());
  });

  test('a pass beyond the budget still fails the item', async () => {
    fixtures.planApproval = { id: QUEUE_ITEM.taskId, autoApprovePlan: true, parentId: null };
    fixtures.states = [
      state({ workflowStatus: 'plan_created' }),
      state({ workflowStatus: 'completed', status: 'done' }),
    ];
    await runWithBudgetOfOne();

    expect(queueMock.retryIfPossible).toHaveBeenCalledWith(
      QUEUE_ITEM.id,
      `Maximum iterations (1) exceeded for task ${QUEUE_ITEM.taskId}`,
    );
  });
});
