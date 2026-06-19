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

// The run used to end at "[調査完了]…次のフェーズへ" with no sign the PR opened.
// On terminal completion with a PR url, surface it in the log.
describe('PR creation surfaced in the completion log', () => {
  it('appends a PR line when the task is terminal and a PR url is present', () => {
    const updater = handleCompleted(
      {
        executionStatus: 'completed',
        sessionMode: 'workflow-verifier',
        workflowStatus: 'completed',
        taskStatus: 'done',
        prUrl: 'https://github.com/o/r/pull/175',
        prNumber: 175,
      },
      makeRefs(),
    );
    const log = updater!(emptyState()).logs.join('');
    expect(log).toContain('PRを作成しました');
    expect(log).toContain('#175');
    expect(log).toContain('https://github.com/o/r/pull/175');
  });

  it('does NOT append a PR line at a non-terminal phase boundary', () => {
    const updater = handleCompleted(
      {
        executionStatus: 'completed',
        sessionMode: 'workflow-researcher',
        workflowStatus: 'research_done',
        taskStatus: 'in-progress',
        prUrl: 'https://github.com/o/r/pull/175',
      },
      makeRefs(),
    );
    expect(updater!(emptyState()).logs.join('')).not.toContain('PRを作成しました');
  });

  it('does NOT append a PR line when no PR exists', () => {
    const updater = handleCompleted(
      {
        executionStatus: 'completed',
        sessionMode: 'workflow-verifier',
        workflowStatus: 'completed',
        taskStatus: 'done',
        prUrl: null,
      },
      makeRefs(),
    );
    expect(updater!(emptyState()).logs.join('')).not.toContain('PRを作成しました');
  });
});

// Regression (task 185): a verifier execution can COMPLETE while the task bounces
// into the self-repair loop (verify → implement → verify). The verifier phase is
// not auto-advancing, so the poller used to stop and freeze the UI at 完了 until a
// manual reload. Keep polling while the task is still 'in-progress'.
describe('verify self-repair seam keeps the UI live', () => {
  it('keeps polling when a completed verifier left the task in-progress', () => {
    expect(
      shouldKeepPollingAfterCompleted({
        sessionMode: 'workflow-verifier',
        workflowStatus: 'plan_approved',
        taskStatus: 'in-progress',
      }),
    ).toBe(true);
  });

  it('stops once the task reaches a terminal/blocked state', () => {
    expect(
      shouldKeepPollingAfterCompleted({
        sessionMode: 'workflow-verifier',
        workflowStatus: 'plan_approved',
        taskStatus: 'blocked',
      }),
    ).toBe(false);
  });

  it('handleCompleted stays running (not 完了) while the task is in-progress', () => {
    const updater = handleCompleted(
      {
        executionStatus: 'completed',
        sessionMode: 'workflow-verifier',
        workflowStatus: 'plan_approved',
        taskStatus: 'in-progress',
      },
      makeRefs(),
    );
    const state = updater!(emptyState());
    expect(state.status).toBe('running');
    expect(state.isRunning).toBe(true);
  });
});
