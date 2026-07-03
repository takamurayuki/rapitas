/**
 * execution-manager.execute.test
 *
 * Unit tests for AgentExecutionManager.executeTask: registry lookup, the
 * concurrency limit, executionId/timeout defaulting, state tracking, the
 * success/error paths (including scheduled cleanup), and custom-logger wiring.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { AgentExecutionManager } from './execution-manager';
import { AgentRegistry } from './registry';
import type { IAgentLogger } from './interfaces';
import type { AgentExecutionContext, AgentExecutionResult } from './types';
import {
  makeContext,
  makeFakeAgent,
  makeResult,
  registerFakeAgent,
  useSyncTimers,
} from './execution-manager.test-helpers';

beforeEach(() => {
  AgentRegistry.resetInstance();
});

afterEach(() => {
  AgentRegistry.resetInstance();
});

describe('AgentExecutionManager.executeTask', () => {
  it('throws when the agent is not found in the registry', async () => {
    const manager = new AgentExecutionManager();
    await expect(
      manager.executeTask('missing-agent', { id: 1, title: 't' }, makeContext()),
    ).rejects.toThrow('Agent not found: missing-agent');
  });

  it('throws when the concurrent execution limit is reached', async () => {
    const manager = new AgentExecutionManager({ maxConcurrentExecutions: 1 });
    const blocker = makeFakeAgent('blocker', {
      execute: mock(() => new Promise<AgentExecutionResult>(() => {})),
    });
    registerFakeAgent(blocker);

    // Fire-and-forget: leaves one execution stuck in 'initializing'/'running'.
    void manager.executeTask('blocker', { id: 1, title: 't' }, makeContext());

    await expect(
      manager.executeTask('blocker', { id: 2, title: 't2' }, makeContext()),
    ).rejects.toThrow('Maximum concurrent executions (1) reached');
  });

  it('runs a task to completion, updates state, and schedules cleanup', async () => {
    const restoreTimers = useSyncTimers();
    try {
      const manager = new AgentExecutionManager();
      const agent = makeFakeAgent('agent-1', {
        execute: mock(async () => makeResult({ state: 'completed' })),
      });
      registerFakeAgent(agent);

      const result = await manager.executeTask(
        'agent-1',
        { id: 1, title: 't' },
        makeContext({ executionId: 'exec-1' }),
      );

      expect(result.state).toBe('completed');
      expect(agent.execute).toHaveBeenCalledTimes(1);
      // Cleanup ran synchronously (fake timer), so the execution record is gone.
      expect(manager.getExecutionDetails('exec-1')).toBeNull();
    } finally {
      restoreTimers();
    }
  });

  it('generates an executionId when the context does not supply one', async () => {
    const manager = new AgentExecutionManager();
    let capturedContext: AgentExecutionContext | null = null;
    const agent = makeFakeAgent('agent-2', {
      execute: mock(async (_task, ctx: AgentExecutionContext) => {
        capturedContext = ctx;
        return makeResult();
      }),
    });
    registerFakeAgent(agent);

    await manager.executeTask('agent-2', { id: 1, title: 't' }, makeContext());

    expect(capturedContext).not.toBeNull();
    expect(capturedContext!.executionId).toMatch(/^exec-/);
  });

  it('preserves an explicit executionId and applies the default timeout', async () => {
    const manager = new AgentExecutionManager({ defaultTimeout: 12345 });
    let capturedContext: AgentExecutionContext | null = null;
    const agent = makeFakeAgent('agent-3', {
      execute: mock(async (_task, ctx: AgentExecutionContext) => {
        capturedContext = ctx;
        return makeResult();
      }),
    });
    registerFakeAgent(agent);

    await manager.executeTask(
      'agent-3',
      { id: 1, title: 't' },
      makeContext({ executionId: 'fixed-exec-id' }),
    );

    expect(capturedContext!.executionId).toBe('fixed-exec-id');
    expect(capturedContext!.timeout).toBe(12345);
  });

  it('does not override an explicit context.timeout', async () => {
    const manager = new AgentExecutionManager({ defaultTimeout: 12345 });
    let capturedContext: AgentExecutionContext | null = null;
    const agent = makeFakeAgent('agent-4', {
      execute: mock(async (_task, ctx: AgentExecutionContext) => {
        capturedContext = ctx;
        return makeResult();
      }),
    });
    registerFakeAgent(agent);

    await manager.executeTask('agent-4', { id: 1, title: 't' }, makeContext({ timeout: 999 }));

    expect(capturedContext!.timeout).toBe(999);
  });

  it('tracks state_change events emitted mid-execution', async () => {
    const manager = new AgentExecutionManager();
    const agent = makeFakeAgent('agent-5', {
      execute: mock(async () => {
        await agent.events.emitStateChange('initializing', 'running');
        return makeResult({ state: 'completed' });
      }),
    });
    registerFakeAgent(agent);

    await manager.executeTask(
      'agent-5',
      { id: 1, title: 't' },
      makeContext({ executionId: 'exec-track' }),
    );

    // After completion the final state comes from the result, not the mid-run event.
    expect(manager.getExecutionStatus('exec-track')).toBe('completed');
  });

  it('sets state to failed, schedules cleanup, and rethrows on execute() rejection', async () => {
    const restoreTimers = useSyncTimers();
    try {
      const manager = new AgentExecutionManager();
      const agent = makeFakeAgent('agent-err', {
        execute: mock(async () => {
          throw new Error('boom');
        }),
      });
      registerFakeAgent(agent);

      await expect(
        manager.executeTask(
          'agent-err',
          { id: 1, title: 't' },
          makeContext({ executionId: 'exec-err' }),
        ),
      ).rejects.toThrow('boom');

      // Cleanup ran synchronously via the fake timer.
      expect(manager.getExecutionDetails('exec-err')).toBeNull();
    } finally {
      restoreTimers();
    }
  });

  it('does not schedule cleanup for a non-terminal result state', async () => {
    const manager = new AgentExecutionManager();
    const agent = makeFakeAgent('agent-wait', {
      execute: mock(async () => makeResult({ state: 'waiting_for_input' })),
    });
    registerFakeAgent(agent);

    await manager.executeTask(
      'agent-wait',
      { id: 1, title: 't' },
      makeContext({ executionId: 'exec-wait' }),
    );

    expect(manager.getExecutionDetails('exec-wait')).not.toBeNull();
    expect(manager.getExecutionStatus('exec-wait')).toBe('waiting_for_input');
  });

  it('logs through a custom logger instead of the default pino logger', async () => {
    const infoLog = mock(() => {});
    const logger: IAgentLogger = {
      log: mock(() => {}),
      debug: mock(() => {}),
      info: infoLog,
      warn: mock(() => {}),
      error: mock(() => {}),
      child: mock(() => logger),
    };
    const manager = new AgentExecutionManager({ logger });
    const agent = makeFakeAgent('agent-log', { execute: mock(async () => makeResult()) });
    registerFakeAgent(agent);

    await manager.executeTask('agent-log', { id: 1, title: 't' }, makeContext());

    expect(infoLog).toHaveBeenCalled();
  });

  it('logs an error through a custom logger on failure', async () => {
    const errorLog = mock(() => {});
    const logger: IAgentLogger = {
      log: mock(() => {}),
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: errorLog,
      child: mock(() => logger),
    };
    const manager = new AgentExecutionManager({ logger });
    const agent = makeFakeAgent('agent-log-err', {
      execute: mock(async () => {
        throw new Error('fail-log');
      }),
    });
    registerFakeAgent(agent);

    await expect(
      manager.executeTask('agent-log-err', { id: 1, title: 't' }, makeContext()),
    ).rejects.toThrow('fail-log');

    expect(errorLog).toHaveBeenCalled();
  });
});
