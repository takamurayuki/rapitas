/**
 * workflow-runner.phases.test
 *
 * Covers the 'completed' decision branch inside WorkflowRunner.executeWorkflowItem:
 * completion + subtask propagation. The 'plan_created' branch lives in
 * workflow-runner.plan-approval.test.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  WorkflowRunner,
  QUEUE_ITEM,
  fixtures,
  state,
  runAndSettle,
  resetMocks,
  resetRunner,
  updateStatusMock,
  broadcastItemUpdateCalls,
  onSubtaskCompletedMock,
} from './workflow-runner.phases.test-support';

describe('WorkflowRunner — completion', () => {
  beforeEach(() => {
    resetMocks();
    resetRunner();
  });

  test('completed status finalizes the queue item as completed', async () => {
    fixtures.states = [state({ workflowStatus: 'completed', status: 'done' })];
    const runner = WorkflowRunner.getInstance();
    await runAndSettle(runner);

    expect(updateStatusMock).toHaveBeenCalledWith(
      QUEUE_ITEM.id,
      'completed',
      expect.objectContaining({ currentPhase: 'completed' }),
    );
    expect(broadcastItemUpdateCalls).toContainEqual({
      event: 'workflow_completed',
      phase: 'completed',
    });
    expect(onSubtaskCompletedMock).not.toHaveBeenCalled();
  });

  test('completed subtask propagates completion to its parent', async () => {
    fixtures.states = [state({ workflowStatus: 'completed', status: 'done', parentId: 99 })];
    const runner = WorkflowRunner.getInstance();
    await runAndSettle(runner);

    // onSubtaskCompleted is fired via a fire-and-forget dynamic import — flush microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSubtaskCompletedMock).toHaveBeenCalledWith(QUEUE_ITEM.taskId);
  });
});
