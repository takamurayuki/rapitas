/**
 * abstract-agent.helpers.test
 *
 * Unit tests for the AbstractAgent surface not covered by abstract-agent.test.ts:
 * stop()/pause()/resume()/dispose() and setLifecycleHooks() merge semantics.
 * Protected event-emission helpers (emitOutput/emitQuestion/emitArtifact/
 * emitCommit/notifyToolExecution/updateMetrics/log/transitionState) live in
 * abstract-agent.emitters.test.ts (kept separate to stay under the 500-line cap).
 */
import { describe, it, expect } from 'bun:test';
import { AbstractAgent } from './abstract-agent';
import type {
  AgentCapabilities,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentTaskDefinition,
  ContinuationContext,
  DebugLogEntry,
} from './types';

// ──────────────────────────────────────────────────────────────────────────────
// Fixture
// ──────────────────────────────────────────────────────────────────────────────

function makeCapabilities(): AgentCapabilities {
  return {
    codeGeneration: true,
    codeReview: false,
    codeExecution: false,
    fileRead: true,
    fileWrite: true,
    fileEdit: true,
    terminalAccess: false,
    gitOperations: false,
    webSearch: false,
    webFetch: false,
    taskAnalysis: false,
    taskPlanning: false,
    parallelExecution: false,
    questionAsking: true,
    conversationMemory: false,
    sessionContinuation: true,
  };
}

class TestAgent extends AbstractAgent {
  onDoExecute: (
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ) => Promise<AgentExecutionResult> = async () => ({
    success: true,
    state: 'completed',
    output: 'ok',
  });

  onDoContinue: (
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ) => Promise<AgentExecutionResult> = async () => ({
    success: true,
    state: 'completed',
    output: 'continued',
  });

  onDoStop: () => Promise<void> = async () => {};

  get capabilities(): AgentCapabilities {
    return makeCapabilities();
  }

  protected doExecute(
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    return this.onDoExecute(task, context);
  }

  protected doContinue(
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    return this.onDoContinue(continuation, context);
  }

  protected doStop(): Promise<void> {
    return this.onDoStop();
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async validateConfig(): Promise<{ valid: boolean; errors: string[] }> {
    return { valid: true, errors: [] };
  }

  // Exposes the protected debug-log field for the dispose() idempotency assertion below.
  getDebugLogEntries(): DebugLogEntry[] {
    return this._debugLogs;
  }
}

function makeTask(overrides: Partial<AgentTaskDefinition> = {}): AgentTaskDefinition {
  return { id: 'task-1', title: 'Test task', ...overrides };
}

function makeContext(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return { executionId: 'exec-1', workingDirectory: '/tmp/work', ...overrides };
}

/**
 * Builds a doExecute() stand-in that hangs until resolved, plus a
 * `waitUntilStarted` gate. Polling a `started` flag (rather than a fixed
 * number of `await Promise.resolve()` ticks) avoids flakiness: the number of
 * microtask turns between `execute()` reaching the 'running' state and
 * doExecute() actually being invoked is an implementation detail of
 * transitionState()'s internal awaits, not a stable constant.
 */
function makeHangingExecute(): {
  onDoExecute: () => Promise<AgentExecutionResult>;
  resolve: (result: AgentExecutionResult) => void;
  waitUntilStarted: () => Promise<void>;
} {
  let started = false;
  let resolveFn!: (result: AgentExecutionResult) => void;
  const pending = new Promise<AgentExecutionResult>((res) => {
    resolveFn = res;
  });
  return {
    onDoExecute: async () => {
      started = true;
      return pending;
    },
    resolve: resolveFn,
    waitUntilStarted: async () => {
      for (let i = 0; i < 50 && !started; i++) {
        await Promise.resolve();
      }
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// stop()
// ──────────────────────────────────────────────────────────────────────────────

describe('AbstractAgent — stop()', () => {
  it('is a no-op in idle state', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    let stopCalled = false;
    agent.onDoStop = async () => {
      stopCalled = true;
    };
    await agent.stop();
    expect(stopCalled).toBe(false);
    expect(agent.state).toBe('idle');
  });

  it('is a no-op in completed/failed states', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    await agent.execute(makeTask(), makeContext());
    expect(agent.state).toBe('completed');

    let stopCalled = false;
    agent.onDoStop = async () => {
      stopCalled = true;
    };
    await agent.stop();
    expect(stopCalled).toBe(false);
  });

  it('calls doStop, transitions to cancelled, and invokes onShutdown while running', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const hang = makeHangingExecute();
    agent.onDoExecute = hang.onDoExecute;
    const shutdownReasons: string[] = [];
    agent.setLifecycleHooks({
      onShutdown: async (_ctx, reason) => {
        shutdownReasons.push(reason);
      },
    });

    const executePromise = agent.execute(makeTask(), makeContext());
    await hang.waitUntilStarted();
    expect(agent.state).toBe('running');

    await agent.stop();
    expect(agent.state).toBe('cancelled');
    expect(shutdownReasons).toEqual(['cancelled']);

    hang.resolve({ success: true, state: 'completed', output: '' });
    await executePromise;
  });

  it('transitions to failed when doStop throws', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const hang = makeHangingExecute();
    agent.onDoExecute = hang.onDoExecute;
    agent.onDoStop = async () => {
      throw new Error('stop failed');
    };

    const executePromise = agent.execute(makeTask(), makeContext());
    await hang.waitUntilStarted();

    await agent.stop();
    expect(agent.state).toBe('failed');

    hang.resolve({ success: true, state: 'completed', output: '' });
    await executePromise;
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// pause() / resume()
// ──────────────────────────────────────────────────────────────────────────────

describe('AbstractAgent — pause()/resume()', () => {
  it('pause() returns false when not running', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    expect(await agent.pause()).toBe(false);
  });

  it('resume() returns false when not paused', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    expect(await agent.resume()).toBe(false);
  });

  it('pause() returns false (unsupported by default) even while running', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const hang = makeHangingExecute();
    agent.onDoExecute = hang.onDoExecute;
    const executePromise = agent.execute(makeTask(), makeContext());
    await hang.waitUntilStarted();

    expect(await agent.pause()).toBe(false);

    hang.resolve({ success: true, state: 'completed', output: '' });
    await executePromise;
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// setLifecycleHooks()
// ──────────────────────────────────────────────────────────────────────────────

describe('AbstractAgent — setLifecycleHooks()', () => {
  it('merges new hooks with previously-set hooks instead of replacing them', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const beforeCalls: string[] = [];
    const afterCalls: string[] = [];
    agent.setLifecycleHooks({
      beforeExecute: async () => {
        beforeCalls.push('before');
      },
    });
    agent.setLifecycleHooks({
      afterExecute: async () => {
        afterCalls.push('after');
      },
    });

    await agent.execute(makeTask(), makeContext());

    expect(beforeCalls).toEqual(['before']);
    expect(afterCalls).toEqual(['after']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// dispose()
// ──────────────────────────────────────────────────────────────────────────────

describe('AbstractAgent — dispose()', () => {
  it('marks the agent disposed and resets internal state from idle', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    agent.events.on('state_change', async () => {});
    expect(agent.events.listenerCount()).toBe(1);

    await agent.dispose();

    expect(agent.state).toBe('idle');
    expect(agent.events.listenerCount()).toBe(0);
  });

  it('calls stop() first when disposing a running agent', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const hang = makeHangingExecute();
    agent.onDoExecute = hang.onDoExecute;
    let stopCalled = false;
    agent.onDoStop = async () => {
      stopCalled = true;
    };

    const executePromise = agent.execute(makeTask(), makeContext());
    await hang.waitUntilStarted();
    expect(agent.state).toBe('running');

    await agent.dispose();
    expect(stopCalled).toBe(true);

    hang.resolve({ success: true, state: 'completed', output: '' });
    await executePromise;
  });

  it('is idempotent — a second dispose() call is a no-op', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    await agent.dispose();
    const logCountAfterFirst = agent.getDebugLogEntries().length;
    await agent.dispose();
    // debugLogs are cleared by dispose(), so a second no-op call should not
    // push a new "Disposing agent" entry (the early-return guard short-circuits).
    expect(agent.getDebugLogEntries().length).toBe(logCountAfterFirst);
  });

  it('rejects execute() and continue() after disposal', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    await agent.dispose();
    await expect(agent.execute(makeTask(), makeContext())).rejects.toThrow(
      'Agent has been disposed',
    );
    await expect(
      agent.continue({ sessionId: 's', previousExecutionId: 'e' }, makeContext()),
    ).rejects.toThrow('Agent has been disposed');
  });
});
