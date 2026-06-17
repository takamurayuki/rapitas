import {
  handleCompleted,
  shouldKeepPollingAfterCompleted,
  type PollRefs,
} from '../execution-poll-handlers';
import type { ExecutionStreamState } from '../execution-stream-types';

function makeRefs(): PollRefs {
  return {
    lastProcessedStatusRef: { current: null },
    hasAddedFinalLogRef: { current: false },
    lastProcessedQuestionRef: { current: null },
    responseGraceUntilRef: { current: 0 },
    clearedQuestionRef: { current: null },
    terminalStatusGraceUntilRef: { current: 0 },
    lastExecutionIdRef: { current: null },
  };
}

const emptyState = () => ({ logs: [] }) as unknown as ExecutionStreamState;

describe('handleCompleted (auto-advancing phase dedup)', () => {
  it('emits the phase-completion message once, then dedupes repeat polls', () => {
    const refs = makeRefs();
    const data = { executionStatus: 'completed', sessionMode: 'workflow-researcher' };

    // First poll of the completed researcher row → emit the message.
    const first = handleCompleted(data, refs);
    expect(first).not.toBeNull();
    const state = first!(emptyState());
    expect(state.logs.join('')).toContain('調査フェーズが完了しました');
    // Stays "running" across an auto-advancing seam (no flash of 完了).
    expect(state.status).toBe('running');

    // Same completed row on the next poll → must NOT re-emit (the bug was a
    // reset here that re-logged the message on every poll).
    expect(handleCompleted(data, refs)).toBeNull();
    expect(handleCompleted(data, refs)).toBeNull();
  });

  it('marks a terminal (non-auto-advancing) phase as completed', () => {
    const refs = makeRefs();
    const updater = handleCompleted(
      { executionStatus: 'completed', sessionMode: 'workflow-verifier' },
      refs,
    );
    const state = updater!(emptyState());
    expect(state.status).toBe('completed');
    expect(state.isRunning).toBe(false);
  });
});

describe('shouldKeepPollingAfterCompleted', () => {
  it('keeps polling after auto-advancing phases', () => {
    expect(shouldKeepPollingAfterCompleted({ sessionMode: 'workflow-researcher' })).toBe(true);
    expect(shouldKeepPollingAfterCompleted({ sessionMode: 'workflow-implementer' })).toBe(true);
  });

  it('stops after a terminal phase or a non-workflow run', () => {
    expect(shouldKeepPollingAfterCompleted({ sessionMode: 'workflow-verifier' })).toBe(false);
    expect(shouldKeepPollingAfterCompleted({ sessionMode: null })).toBe(false);
  });
});

// Regression: a single dev-mode execution can finish the WHOLE workflow in one
// AgentExecution whose sessionMode is an auto-advancing phase. Once the task is
// terminal there is no next phase, so the poller must finalize (status
// 'completed', stop polling) instead of waiting forever — previously the run
// stayed "進行中" with no "PRを開く" button until a manual reload.
describe('terminal task finalization for auto-advancing single executions', () => {
  it('stops polling once the task workflow is completed', () => {
    expect(
      shouldKeepPollingAfterCompleted({
        sessionMode: 'workflow-researcher',
        workflowStatus: 'completed',
        taskStatus: 'done',
      }),
    ).toBe(false);
  });

  it('still polls while the auto-advancing task is in flight', () => {
    expect(
      shouldKeepPollingAfterCompleted({
        sessionMode: 'workflow-researcher',
        workflowStatus: 'research_done',
        taskStatus: 'in-progress',
      }),
    ).toBe(true);
  });

  it('handleCompleted finalizes to completed when the task is terminal', () => {
    const updater = handleCompleted(
      {
        executionStatus: 'completed',
        sessionMode: 'workflow-researcher',
        workflowStatus: 'completed',
        taskStatus: 'done',
      },
      makeRefs(),
    );
    const state = updater!(emptyState());
    expect(state.status).toBe('completed');
    expect(state.isRunning).toBe(false);
  });
});
