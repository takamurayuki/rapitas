import { executePoll } from '../execution-poll-loop';
import type { PollRefs } from '../execution-poll-shared';
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

function makeHarness(initial: Partial<ExecutionStreamState>) {
  let state: ExecutionStreamState = {
    isConnected: true,
    isRunning: false,
    logs: [],
    status: 'idle',
    error: null,
    result: null,
    ...initial,
  };
  const setState = (
    updater: ExecutionStreamState | ((prev: ExecutionStreamState) => ExecutionStreamState),
  ) => {
    state = typeof updater === 'function' ? updater(state) : updater;
  };
  return { getState: () => state, setState };
}

describe('executePoll — running status clears stale question state', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Regression (question-answer resume bug): the 'running' branch only ever
  // updated isRunning/status, relying entirely on the client's own optimistic
  // clearQuestion() call (fired only once the — potentially slow —
  // /agent-respond POST resolves) to clear waitingForInput/question. A
  // genuine 'running' poll result is unconditional proof the backend has
  // already moved past the question and must clear it itself.
  it('clears waitingForInput and question once the backend reports running', async () => {
    global.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ executionStatus: 'running' }),
      })) as unknown as typeof fetch;

    const refs = makeRefs();
    const { getState, setState } = makeHarness({
      waitingForInput: true,
      question: 'stale question',
      status: 'waiting_for_input',
    });
    const lastOutputLengthRef = { current: 0 };

    await executePoll(1, refs, lastOutputLengthRef, setState, () => {});

    const state = getState();
    expect(state.isRunning).toBe(true);
    expect(state.status).toBe('running');
    expect(state.waitingForInput).toBe(false);
    expect(state.question).toBeUndefined();
  });

  it('is a no-op (returns the same state reference) when already running with no stale question', async () => {
    global.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ executionStatus: 'running' }),
      })) as unknown as typeof fetch;

    const refs = makeRefs();
    const { getState, setState } = makeHarness({
      isRunning: true,
      status: 'running',
      waitingForInput: false,
    });
    const before = getState();
    const lastOutputLengthRef = { current: 0 };

    await executePoll(1, refs, lastOutputLengthRef, setState, () => {});

    expect(getState()).toBe(before);
  });
});
