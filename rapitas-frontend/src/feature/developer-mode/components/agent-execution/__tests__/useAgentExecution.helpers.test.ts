/**
 * useAgentExecution.helpers tests
 *
 * Pure derivation functions extracted from useAgentExecution: no existing
 * test file covered them prior to this one.
 */
import {
  computeQuestionState,
  parseQuestionWithDetails,
  computeStatusFlags,
} from '../useAgentExecution.helpers';

describe('computeQuestionState', () => {
  test('surfaces a question when not terminal, waiting for input, and a question string exists', () => {
    const result = computeQuestionState(false, true, 'Pick a branch name', 'tool_call');
    expect(result).toEqual({
      hasQuestion: true,
      question: 'Pick a branch name',
      questionType: 'tool_call',
    });
  });

  test('normalizes any non "tool_call" questionType to "none"', () => {
    const result = computeQuestionState(false, true, 'Q?', 'pattern_match');
    expect(result.questionType).toBe('none');
  });

  test('suppresses the question once the execution reaches a terminal status', () => {
    const result = computeQuestionState(true, true, 'Q?', 'tool_call');
    expect(result).toEqual({ hasQuestion: false, question: '', questionType: 'none' });
  });

  test('suppresses the question when not actually waiting for input', () => {
    const result = computeQuestionState(false, false, 'Q?', 'tool_call');
    expect(result.hasQuestion).toBe(false);
  });

  test('suppresses the question when the question text is empty', () => {
    const result = computeQuestionState(false, true, undefined, 'tool_call');
    expect(result.hasQuestion).toBe(false);
  });
});

describe('parseQuestionWithDetails', () => {
  const t = (key: string) => `[${key}]`;

  test('returns null for an undefined question', () => {
    expect(parseQuestionWithDetails(undefined, null, t)).toBeNull();
  });

  test('prefers structured questionDetails options over text parsing', () => {
    const result = parseQuestionWithDetails(
      'Pick an approach',
      { options: [{ label: 'Option A' }, { label: 'Option B', description: 'desc' }] },
      t,
    );
    expect(result).toEqual({ text: 'Pick an approach', options: ['Option A', 'Option B'] });
  });

  test('falls back to text-based parsing when questionDetails has no options', () => {
    const result = parseQuestionWithDetails('続行しますか？', { headers: ['h1'] }, t);
    expect(result).toEqual({ text: '続行しますか？', options: ['[yes]', '[no]'] });
  });

  test('falls back to text-based parsing when questionDetails is null', () => {
    const result = parseQuestionWithDetails('続行しますか？', null, t);
    expect(result).toEqual({ text: '続行しますか？', options: ['[yes]', '[no]'] });
  });

  test('returns null when text-based parsing finds no recognizable shape', () => {
    const result = parseQuestionWithDetails('Everything looks fine and ready to ship.', null, t);
    expect(result).toBeNull();
  });
});

describe('computeStatusFlags', () => {
  function baseParams() {
    return {
      finalStatus: 'running',
      isPollingRunning: false,
      isSseRunning: false,
      isWaitingForInput: false,
      isRestoredTerminal: false,
      executionResult: null as { success?: boolean } | null,
      isExecuting: false,
      pollingStatus: 'idle',
      sseStatus: 'idle',
      error: null as string | null,
      pollingError: null as string | null,
      sseError: null as string | null,
    };
  }

  test('isCompleted when finalStatus is completed and nothing is still polling/streaming', () => {
    const flags = computeStatusFlags({ ...baseParams(), finalStatus: 'completed' });
    expect(flags.isCompleted).toBe(true);
    expect(flags.isRunning).toBe(false);
  });

  test('is not completed while polling is still running even if finalStatus says completed', () => {
    const flags = computeStatusFlags({
      ...baseParams(),
      finalStatus: 'completed',
      isPollingRunning: true,
    });
    expect(flags.isCompleted).toBe(false);
  });

  test('is not completed when SSE reports the phase boundary as completed but polling still says running', () => {
    // Regression: useExecutionStreamSSE's execution_completed handler sets
    // status:'completed' unconditionally on every workflow phase boundary
    // (research/plan/implement each end their own AgentExecution row), with
    // no way to know the orchestrator is about to auto-advance to the next
    // phase. finalStatus prefers sseStatus over pollingStatus, so without
    // this guard the Reset/PR-open buttons flashed on every phase boundary
    // (self-correcting once the next phase's real state took over — hence
    // "reload fixes it"). pollingStatus is set to 'running' by
    // execution-poll-completion.ts's handleCompleted specifically to signal
    // "this completed row is a phase boundary, not the real end" — isRunning
    // flags (isPollingRunning/isSseRunning) can both already be false by
    // this point, since neither poller/stream has picked up the NEXT
    // phase's execution yet.
    const flags = computeStatusFlags({
      ...baseParams(),
      finalStatus: 'completed', // from sseStatus, per finalStatus's priority
      sseStatus: 'completed',
      pollingStatus: 'running', // execution-poll-completion.ts's auto-advance signal
      isPollingRunning: false,
      isSseRunning: false,
    });
    expect(flags.isCompleted).toBe(false);
  });

  test('a restored terminal session with success=true counts as completed', () => {
    const flags = computeStatusFlags({
      ...baseParams(),
      isRestoredTerminal: true,
      executionResult: { success: true },
    });
    expect(flags.isCompleted).toBe(true);
  });

  test('a restored terminal session with success=false counts as failed, not completed', () => {
    const flags = computeStatusFlags({
      ...baseParams(),
      isRestoredTerminal: true,
      executionResult: { success: false },
    });
    expect(flags.isFailed).toBe(true);
    expect(flags.isCompleted).toBe(false);
  });

  test('isCancelled reflects finalStatus === cancelled', () => {
    const flags = computeStatusFlags({ ...baseParams(), finalStatus: 'cancelled' });
    expect(flags.isCancelled).toBe(true);
  });

  test('isFailed is true when any of the three error fields is set', () => {
    expect(computeStatusFlags({ ...baseParams(), error: 'boom' }).isFailed).toBe(true);
    expect(computeStatusFlags({ ...baseParams(), pollingError: 'boom' }).isFailed).toBe(true);
    expect(computeStatusFlags({ ...baseParams(), sseError: 'boom' }).isFailed).toBe(true);
  });

  test('isRunning is true while executing, even if not restored/terminal', () => {
    const flags = computeStatusFlags({ ...baseParams(), isExecuting: true });
    expect(flags.isRunning).toBe(true);
  });

  test('isRunning is false once restored to a terminal state, regardless of other running flags', () => {
    const flags = computeStatusFlags({
      ...baseParams(),
      isRestoredTerminal: true,
      isExecuting: true,
      executionResult: { success: true },
    });
    expect(flags.isRunning).toBe(false);
  });

  test('isRunning is true when waiting for input', () => {
    const flags = computeStatusFlags({ ...baseParams(), isWaitingForInput: true });
    expect(flags.isRunning).toBe(true);
  });
});
