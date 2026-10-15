/**
 * agent-lifecycle-handlers.execute.test
 *
 * Unit tests for runExecute(): beforeExecute/afterExecute hook gating,
 * state-transition ordering per result shape, and error wrapping.
 */
import { describe, it, expect, mock } from 'bun:test';
import { runExecute } from './agent-lifecycle-handlers';
import { AgentEventEmitter } from './event-emitter';
import { AgentError } from './interfaces';
import type { AgentExecutionContext, AgentExecutionResult, AgentLifecycleHooks } from './types';
import {
  noHooks,
  noLog,
  makeContext,
  makeTask,
  makeResult,
  makeCallbacks,
  makeTransitionSpy,
} from './agent-lifecycle-handlers.test-support';

describe('runExecute — beforeExecute hook cancellation', () => {
  it('returns a cancelled result and never transitions state when beforeExecute returns false', async () => {
    const cb = makeCallbacks();
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const hooks: AgentLifecycleHooks = { beforeExecute: async () => false };
    const doExecute = mock(async () => makeResult());

    const result = await runExecute(
      makeTask(),
      makeContext(),
      cb,
      hooks,
      events,
      doExecute,
      transition.fn,
      noLog,
    );

    expect(result.success).toBe(false);
    expect(result.state).toBe('cancelled');
    expect(result.errorMessage).toBe('Cancelled by beforeExecute hook');
    expect(doExecute).not.toHaveBeenCalled();
    expect(transition.calls).toEqual([]);
    // finally block still clears the current context
    expect(cb.getContextCalls.at(-1)).toBeNull();
  });

  it('proceeds normally when beforeExecute returns true', async () => {
    const cb = makeCallbacks();
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const hooks: AgentLifecycleHooks = { beforeExecute: async () => true };
    const doExecute = mock(async () => makeResult());

    const result = await runExecute(
      makeTask(),
      makeContext(),
      cb,
      hooks,
      events,
      doExecute,
      transition.fn,
      noLog,
    );

    expect(result.success).toBe(true);
    expect(doExecute).toHaveBeenCalledTimes(1);
  });

  it('proceeds normally when beforeExecute is not configured', async () => {
    const cb = makeCallbacks();
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const doExecute = mock(async () => makeResult());

    const result = await runExecute(
      makeTask(),
      makeContext(),
      cb,
      noHooks,
      events,
      doExecute,
      transition.fn,
      noLog,
    );

    expect(result.success).toBe(true);
    expect(transition.calls.map((c) => c[0])).toEqual(['initializing', 'running', 'completed']);
  });
});

describe('runExecute — result-state branches', () => {
  it('transitions to completed on success with no pending question', async () => {
    const cb = makeCallbacks();
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const doExecute = mock(async () => makeResult({ success: true }));

    await runExecute(
      makeTask(),
      makeContext(),
      cb,
      noHooks,
      events,
      doExecute,
      transition.fn,
      noLog,
    );

    expect(transition.calls.map((c) => c[0])).toEqual(['initializing', 'running', 'completed']);
  });

  it('transitions to waiting_for_input when the result carries a pendingQuestion', async () => {
    const cb = makeCallbacks();
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const doExecute = mock(async () =>
      makeResult({
        success: true,
        pendingQuestion: { questionId: 'q1', text: 'ok?', category: 'confirmation' },
      }),
    );

    await runExecute(
      makeTask(),
      makeContext(),
      cb,
      noHooks,
      events,
      doExecute,
      transition.fn,
      noLog,
    );

    expect(transition.calls.map((c) => c[0])).toEqual([
      'initializing',
      'running',
      'waiting_for_input',
    ]);
  });

  it('transitions to failed when the result is unsuccessful with no pending question', async () => {
    const cb = makeCallbacks();
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const doExecute = mock(async () => makeResult({ success: false }));

    await runExecute(
      makeTask(),
      makeContext(),
      cb,
      noHooks,
      events,
      doExecute,
      transition.fn,
      noLog,
    );

    expect(transition.calls.map((c) => c[0])).toEqual(['initializing', 'running', 'failed']);
  });

  it('calls afterExecute with the context and final result', async () => {
    const cb = makeCallbacks();
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const afterExecute = mock(async () => {});
    const doExecute = mock(async () => makeResult({ output: 'final' }));
    const context = makeContext();

    const result = await runExecute(
      makeTask(),
      context,
      cb,
      { afterExecute },
      events,
      doExecute,
      transition.fn,
      noLog,
    );

    expect(afterExecute).toHaveBeenCalledTimes(1);
    const [passedContext, passedResult] = afterExecute.mock.calls[0] as [
      AgentExecutionContext,
      AgentExecutionResult,
    ];
    expect(passedContext).toBe(context);
    expect(passedResult.output).toBe('final');
    expect(result.metrics?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('updates metadata.lastUsedAt on success', async () => {
    const cb = makeCallbacks();
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const doExecute = mock(async () => makeResult());

    await runExecute(
      makeTask(),
      makeContext(),
      cb,
      noHooks,
      events,
      doExecute,
      transition.fn,
      noLog,
    );

    expect(cb.getMetadata().lastUsedAt).toBeInstanceOf(Date);
  });

  it('merges collected debug logs with the result debugInfo (result fields win)', async () => {
    const cb = makeCallbacks();
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const doExecute = mock(async () => makeResult({ debugInfo: { logs: [], rawOutput: 'raw' } }));

    const result = await runExecute(
      makeTask(),
      makeContext(),
      cb,
      noHooks,
      events,
      doExecute,
      transition.fn,
      noLog,
    );

    expect(result.debugInfo?.rawOutput).toBe('raw');
  });
});

describe('runExecute — error path', () => {
  it('wraps a thrown AgentError, transitions to failed, emits error, and clears context', async () => {
    const cb = makeCallbacks();
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const emittedErrors: Error[] = [];
    events.on('error', async (event) => {
      const err = (event as unknown as { error: Error }).error;
      emittedErrors.push(err);
    });
    const thrown = new AgentError('boom', 'execution', false);
    const doExecute = mock(async () => {
      throw thrown;
    });

    const result = await runExecute(
      makeTask(),
      makeContext(),
      cb,
      noHooks,
      events,
      doExecute,
      transition.fn,
      noLog,
    );

    expect(result.success).toBe(false);
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toBe('boom');
    expect(transition.calls.map((c) => c[0])).toEqual(['initializing', 'running', 'failed']);
    expect(emittedErrors).toHaveLength(1);
    expect(emittedErrors[0]).toBe(thrown);
    expect(cb.getContextCalls.at(-1)).toBeNull();
  });

  it('wraps a plain Error thrown by doExecute as an AgentError', async () => {
    const cb = makeCallbacks();
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const doExecute = mock(async () => {
      throw new Error('plain failure');
    });

    const result = await runExecute(
      makeTask(),
      makeContext(),
      cb,
      noHooks,
      events,
      doExecute,
      transition.fn,
      noLog,
    );

    expect(result.errorMessage).toBe('plain failure');
  });

  it('wraps a non-Error thrown value as an internal AgentError', async () => {
    const cb = makeCallbacks();
    const transition = makeTransitionSpy();
    const events = new AgentEventEmitter('agent-1');
    const doExecute = mock(async () => {
      throw 'string failure';
    });

    const result = await runExecute(
      makeTask(),
      makeContext(),
      cb,
      noHooks,
      events,
      doExecute,
      transition.fn,
      noLog,
    );

    expect(result.errorMessage).toBe('string failure');
  });
});
