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
    expect(state.logs.join('')).toContain('リサーチフェーズが完了しました');
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
