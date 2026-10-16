/**
 * agent-event-helpers.tool-metrics.test
 *
 * Unit tests for notifyToolExecution (tool_start/tool_end + before/afterToolCall
 * hooks) and updateMetrics (mutate + emit metrics_update).
 */
import { describe, it, expect, mock } from 'bun:test';
import { notifyToolExecution, updateMetrics } from './agent-event-helpers';
import { AgentEventEmitter } from './event-emitter';
import type {
  AgentExecutionContext,
  AgentLifecycleHooks,
  ExecutionMetrics,
  ToolStartEvent,
  ToolEndEvent,
  MetricsUpdateEvent,
} from './types';

function makeContext(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return { executionId: 'exec-1', workingDirectory: '/tmp/work', ...overrides };
}

const noLog = () => {};

// ── notifyToolExecution ──

describe('notifyToolExecution', () => {
  it('emits tool_start with the given id/name/input', async () => {
    const events = new AgentEventEmitter('agent-1');
    const captured: ToolStartEvent[] = [];
    events.on<ToolStartEvent>('tool_start', async (e) => {
      captured.push(e);
    });

    await notifyToolExecution(events, {}, makeContext(), 'tool-1', 'bash', { cmd: 'ls' }, noLog);

    expect(captured).toHaveLength(1);
    expect(captured[0].toolId).toBe('tool-1');
    expect(captured[0].toolName).toBe('bash');
    expect(captured[0].input).toEqual({ cmd: 'ls' });
  });

  it('logs a skip message and does not start the tool when beforeToolCall returns false', async () => {
    const events = new AgentEventEmitter('agent-1');
    const logFn = mock(() => {});
    const captured: ToolStartEvent[] = [];
    events.on<ToolStartEvent>('tool_start', async (e) => {
      captured.push(e);
    });
    const hooks: AgentLifecycleHooks = { beforeToolCall: async () => false };

    const result = await notifyToolExecution(
      events,
      hooks,
      makeContext(),
      'tool-2',
      'edit',
      {},
      logFn,
    );

    expect(logFn).toHaveBeenCalledTimes(1);
    expect(logFn.mock.calls[0][1]).toContain('skipped by beforeToolCall hook');
    expect(captured).toHaveLength(0);
    expect(result.skipped).toBe(true);
  });

  it('does not log when beforeToolCall returns true/undefined', async () => {
    const events = new AgentEventEmitter('agent-1');
    const logFn = mock(() => {});
    const hooks: AgentLifecycleHooks = { beforeToolCall: async () => true };

    await notifyToolExecution(events, hooks, makeContext(), 'tool-3', 'edit', {}, logFn);

    expect(logFn).not.toHaveBeenCalled();
  });

  it('end() emits tool_end with the outcome and invokes afterToolCall', async () => {
    const events = new AgentEventEmitter('agent-1');
    const captured: ToolEndEvent[] = [];
    events.on<ToolEndEvent>('tool_end', async (e) => {
      captured.push(e);
    });
    const context = makeContext();
    const afterToolCall = mock(async () => {});

    const { end } = await notifyToolExecution(
      events,
      { afterToolCall },
      context,
      'tool-4',
      'write',
      { path: 'a.txt' },
      noLog,
    );
    await end({ bytes: 10 }, true, undefined);

    expect(captured).toHaveLength(1);
    expect(captured[0].toolId).toBe('tool-4');
    expect(captured[0].success).toBe(true);
    expect(captured[0].output).toEqual({ bytes: 10 });
    expect(captured[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(afterToolCall).toHaveBeenCalledWith(
      context,
      'write',
      { path: 'a.txt' },
      { bytes: 10 },
      true,
    );
  });

  it('end() forwards a failure and error message', async () => {
    const events = new AgentEventEmitter('agent-1');
    const captured: ToolEndEvent[] = [];
    events.on<ToolEndEvent>('tool_end', async (e) => {
      captured.push(e);
    });

    const { end } = await notifyToolExecution(
      events,
      {},
      makeContext(),
      'tool-5',
      'run',
      {},
      noLog,
    );
    await end(null, false, 'exit code 1');

    expect(captured[0].success).toBe(false);
    expect(captured[0].error).toBe('exit code 1');
  });

  it('end() does not invoke afterToolCall when not configured', async () => {
    const events = new AgentEventEmitter('agent-1');
    const { end } = await notifyToolExecution(
      events,
      {},
      makeContext(),
      'tool-6',
      'run',
      {},
      noLog,
    );
    await expect(end(null, true)).resolves.toBeUndefined();
  });
});

// ── updateMetrics ──

describe('updateMetrics', () => {
  it('applies updates onto the metrics object and emits metrics_update', () => {
    const events = new AgentEventEmitter('agent-1');
    const captured: MetricsUpdateEvent[] = [];
    events.on<MetricsUpdateEvent>('metrics_update', async (e) => {
      captured.push(e);
    });
    const metrics: ExecutionMetrics = { startTime: new Date() };

    updateMetrics(events, metrics, { tokensUsed: 42 });

    expect(metrics.tokensUsed).toBe(42);
    expect(captured).toHaveLength(1);
    expect(captured[0].metrics).toEqual({ tokensUsed: 42 });
  });

  it('does nothing when metrics is null', () => {
    const events = new AgentEventEmitter('agent-1');
    const captured: MetricsUpdateEvent[] = [];
    events.on<MetricsUpdateEvent>('metrics_update', async (e) => {
      captured.push(e);
    });

    updateMetrics(events, null, { tokensUsed: 42 });

    expect(captured).toHaveLength(0);
  });
});
