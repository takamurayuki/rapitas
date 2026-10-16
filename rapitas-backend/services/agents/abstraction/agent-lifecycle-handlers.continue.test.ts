/**
 * agent-lifecycle-handlers.continue.test
 *
 * Unit tests for runContinue(): the waiting_for_input state guard,
 * state-transition ordering per result shape, and error wrapping.
 */
import { describe, it, expect, mock } from 'bun:test';
import { runContinue } from './agent-lifecycle-handlers';
import { AgentEventEmitter } from './event-emitter';
import type { ContinuationContext } from './types';
import {
  noHooks,
  noLog,
  makeContext,
  makeResult,
  makeCallbacks,
  makeTransitionSpy,
} from './agent-lifecycle-handlers.test-support';

describe('runContinue — state guard', () => {
  it('throws when the agent is not in waiting_for_input state', async () => {
    const cb = makeCallbacks('idle');
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const doContinue = mock(async () => makeResult());
    const continuation: ContinuationContext = { sessionId: 's1', previousExecutionId: 'exec-0' };

    await expect(
      runContinue(
        continuation,
        makeContext(),
        cb,
        noHooks,
        events,
        doContinue,
        transition.fn,
        noLog,
      ),
    ).rejects.toThrow(
      "Cannot continue execution: agent is in state 'idle', expected 'waiting_for_input'",
    );

    expect(doContinue).not.toHaveBeenCalled();
    expect(cb.getContextCalls).toEqual([]);
  });
});

describe('runContinue — result-state branches', () => {
  it('transitions running then completed on success', async () => {
    const cb = makeCallbacks('waiting_for_input');
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const doContinue = mock(async () => makeResult({ success: true, output: 'resumed' }));
    const continuation: ContinuationContext = { sessionId: 's1', previousExecutionId: 'exec-0' };

    const result = await runContinue(
      continuation,
      makeContext(),
      cb,
      noHooks,
      events,
      doContinue,
      transition.fn,
      noLog,
    );

    expect(result.output).toBe('resumed');
    expect(transition.calls.map((c) => c[0])).toEqual(['running', 'completed']);
    expect(cb.getContextCalls.at(-1)).toBeNull();
  });

  it('transitions to waiting_for_input again when a new question is pending', async () => {
    const cb = makeCallbacks('waiting_for_input');
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const doContinue = mock(async () =>
      makeResult({
        success: true,
        pendingQuestion: { questionId: 'q2', text: 'more?', category: 'input' },
      }),
    );
    const continuation: ContinuationContext = { sessionId: 's1', previousExecutionId: 'exec-0' };

    await runContinue(
      continuation,
      makeContext(),
      cb,
      noHooks,
      events,
      doContinue,
      transition.fn,
      noLog,
    );

    expect(transition.calls.map((c) => c[0])).toEqual(['running', 'waiting_for_input']);
  });

  it('transitions to failed on an unsuccessful result', async () => {
    const cb = makeCallbacks('waiting_for_input');
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const doContinue = mock(async () => makeResult({ success: false }));
    const continuation: ContinuationContext = { sessionId: 's1', previousExecutionId: 'exec-0' };

    await runContinue(
      continuation,
      makeContext(),
      cb,
      noHooks,
      events,
      doContinue,
      transition.fn,
      noLog,
    );

    expect(transition.calls.map((c) => c[0])).toEqual(['running', 'failed']);
  });
});

describe('runContinue — error path', () => {
  it('wraps the error, transitions to failed, and emits an error event', async () => {
    const cb = makeCallbacks('waiting_for_input');
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const emittedErrors: Error[] = [];
    events.on('error', async (event) => {
      emittedErrors.push((event as unknown as { error: Error }).error);
    });
    const doContinue = mock(async () => {
      throw new Error('continue-boom');
    });
    const continuation: ContinuationContext = { sessionId: 's1', previousExecutionId: 'exec-0' };

    const result = await runContinue(
      continuation,
      makeContext(),
      cb,
      noHooks,
      events,
      doContinue,
      transition.fn,
      noLog,
    );

    expect(result.success).toBe(false);
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toBe('continue-boom');
    expect(transition.calls.map((c) => c[0])).toEqual(['running', 'failed']);
    expect(emittedErrors).toHaveLength(1);
  });
});
