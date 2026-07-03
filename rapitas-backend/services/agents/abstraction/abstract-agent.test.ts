/**
 * abstract-agent.test
 *
 * Unit tests for AbstractAgent's own template-method logic: construction,
 * metadata, and the execute()/continue() lifecycle entry points. Delegated
 * retry/event internals (agent-retry.ts, agent-event-helpers.ts) are covered
 * by their own test files — this file only asserts what AbstractAgent itself
 * wires together.
 *
 * Stop/pause/resume/dispose/protected-helper coverage lives in
 * abstract-agent.helpers.test.ts (kept separate to stay under the 500-line file cap).
 */
import { describe, it, expect } from 'bun:test';
import { AbstractAgent } from './abstract-agent';
import { AgentError } from './interfaces';
import type {
  AgentCapabilities,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentTaskDefinition,
  ContinuationContext,
  AgentState,
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
}

function makeTask(overrides: Partial<AgentTaskDefinition> = {}): AgentTaskDefinition {
  return { id: 'task-1', title: 'Test task', ...overrides };
}

function makeContext(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return { executionId: 'exec-1', workingDirectory: '/tmp/work', ...overrides };
}

// ──────────────────────────────────────────────────────────────────────────────
// Construction & metadata
// ──────────────────────────────────────────────────────────────────────────────

describe('AbstractAgent — construction & metadata', () => {
  it('populates metadata from constructor args and options', () => {
    const agent = new TestAgent('agent-1', 'My Agent', 'claude-code', {
      version: '1.0.0',
      description: 'desc',
      modelId: 'model-x',
      endpoint: 'https://example.test',
    });

    expect(agent.metadata).toMatchObject({
      id: 'agent-1',
      name: 'My Agent',
      providerId: 'claude-code',
      version: '1.0.0',
      description: 'desc',
      modelId: 'model-x',
      endpoint: 'https://example.test',
    });
    expect(agent.metadata.createdAt).toBeInstanceOf(Date);
  });

  it('leaves optional metadata fields undefined when options are omitted', () => {
    const agent = new TestAgent('agent-2', 'Bare Agent', 'custom');
    expect(agent.metadata.version).toBeUndefined();
    expect(agent.metadata.description).toBeUndefined();
    expect(agent.metadata.modelId).toBeUndefined();
    expect(agent.metadata.endpoint).toBeUndefined();
  });

  it('returns a defensive copy from the metadata getter', () => {
    const agent = new TestAgent('agent-3', 'Copy Agent', 'custom');
    const snapshot = agent.metadata;
    snapshot.name = 'mutated';
    expect(agent.metadata.name).toBe('Copy Agent');
  });

  it('starts in the idle state', () => {
    const agent = new TestAgent('agent-4', 'Idle Agent', 'custom');
    expect(agent.state).toBe('idle');
  });

  it('exposes an events emitter scoped to the agent id', () => {
    const agent = new TestAgent('agent-5', 'Event Agent', 'custom');
    expect(agent.events).toBeDefined();
    expect(agent.events.listenerCount()).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// execute()
// ──────────────────────────────────────────────────────────────────────────────

describe('AbstractAgent — execute()', () => {
  it('throws when the agent has been disposed', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    await agent.dispose();
    await expect(agent.execute(makeTask(), makeContext())).rejects.toThrow(AgentError);
    await expect(agent.execute(makeTask(), makeContext())).rejects.toThrow(
      'Agent has been disposed',
    );
  });

  it('transitions idle -> initializing -> running -> completed on success', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const transitions: AgentState[] = [];
    agent.events.on('state_change', async (event) => {
      const e = event as { newState: AgentState };
      transitions.push(e.newState);
    });

    const result = await agent.execute(makeTask(), makeContext());

    expect(result.success).toBe(true);
    expect(agent.state).toBe('completed');
    expect(transitions).toEqual(['initializing', 'running', 'completed']);
  });

  it('calls beforeExecute and afterExecute hooks with the right arguments', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const beforeArgs: unknown[] = [];
    const afterArgs: unknown[] = [];
    agent.setLifecycleHooks({
      beforeExecute: async (ctx, task) => {
        beforeArgs.push([ctx, task]);
      },
      afterExecute: async (ctx, result) => {
        afterArgs.push([ctx, result]);
      },
    });

    const task = makeTask({ id: 'my-task' });
    const context = makeContext({ executionId: 'exec-xyz' });
    await agent.execute(task, context);

    expect(beforeArgs.length).toBe(1);
    expect(afterArgs.length).toBe(1);
    const [beforeCtx, beforeTask] = beforeArgs[0] as [AgentExecutionContext, AgentTaskDefinition];
    expect(beforeCtx.executionId).toBe('exec-xyz');
    expect(beforeTask.id).toBe('my-task');
  });

  it('cancels execution when beforeExecute returns false, without invoking doExecute', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    let doExecuteCalled = false;
    agent.onDoExecute = async () => {
      doExecuteCalled = true;
      return { success: true, state: 'completed', output: '' };
    };
    agent.setLifecycleHooks({ beforeExecute: async () => false });

    const result = await agent.execute(makeTask(), makeContext());

    expect(doExecuteCalled).toBe(false);
    expect(result.success).toBe(false);
    expect(result.state).toBe('cancelled');
    expect(result.errorMessage).toBe('Cancelled by beforeExecute hook');
  });

  it('transitions to failed and returns an error result when doExecute throws a non-recoverable AgentError', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    agent.onDoExecute = async () => {
      throw new AgentError('boom', 'validation', false);
    };

    const result = await agent.execute(makeTask(), makeContext());

    expect(result.success).toBe(false);
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toBe('boom');
    expect(agent.state).toBe('failed');
  });

  it('wraps a plain thrown Error into an AgentError-shaped failure result', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    agent.onDoExecute = async () => {
      throw new Error('plain failure');
    };

    const result = await agent.execute(makeTask(), makeContext());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('plain failure');
  });

  it('emits an error event when execution fails', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    agent.onDoExecute = async () => {
      throw new AgentError('emitted-failure', 'internal', false);
    };
    const errors: string[] = [];
    agent.events.on('error', async (event) => {
      const e = event as { error: Error };
      errors.push(e.error.message);
    });

    await agent.execute(makeTask(), makeContext());

    expect(errors).toEqual(['emitted-failure']);
  });

  it('transitions to waiting_for_input when the result carries a pending question', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    agent.onDoExecute = async () => ({
      success: true,
      state: 'waiting_for_input',
      output: '',
      pendingQuestion: { questionId: 'q1', text: 'Continue?', category: 'confirmation' },
    });

    const result = await agent.execute(makeTask(), makeContext());

    expect(agent.state).toBe('waiting_for_input');
    expect(result.pendingQuestion?.questionId).toBe('q1');
  });

  it('transitions to failed when the result reports success: false without throwing', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    agent.onDoExecute = async () => ({ success: false, state: 'failed', output: 'nope' });

    await agent.execute(makeTask(), makeContext());

    expect(agent.state).toBe('failed');
  });

  it('computes metrics.durationMs and attaches debugInfo.logs to the result', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const result = await agent.execute(makeTask(), makeContext());

    expect(result.metrics?.startTime).toBeInstanceOf(Date);
    expect(result.metrics?.endTime).toBeInstanceOf(Date);
    expect(typeof result.metrics?.durationMs).toBe('number');
    expect(result.metrics?.durationMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.debugInfo?.logs)).toBe(true);
  });

  it('updates metadata.lastUsedAt after a run', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    expect(agent.metadata.lastUsedAt).toBeUndefined();
    await agent.execute(makeTask(), makeContext());
    expect(agent.metadata.lastUsedAt).toBeInstanceOf(Date);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// continue()
// ──────────────────────────────────────────────────────────────────────────────

describe('AbstractAgent — continue()', () => {
  function makeContinuation(overrides: Partial<ContinuationContext> = {}): ContinuationContext {
    return { sessionId: 'session-1', previousExecutionId: 'exec-1', ...overrides };
  }

  it('throws when the agent has been disposed', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    await agent.dispose();
    await expect(agent.continue(makeContinuation(), makeContext())).rejects.toThrow(
      'Agent has been disposed',
    );
  });

  it('throws AgentError when not in waiting_for_input state', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    expect(agent.state).toBe('idle');

    await expect(agent.continue(makeContinuation(), makeContext())).rejects.toThrow(
      "expected 'waiting_for_input'",
    );
  });

  it('runs to completion when resumed from waiting_for_input', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    agent.onDoExecute = async () => ({
      success: true,
      state: 'waiting_for_input',
      output: '',
      pendingQuestion: { questionId: 'q1', text: 'Continue?', category: 'confirmation' },
    });
    await agent.execute(makeTask(), makeContext());
    expect(agent.state).toBe('waiting_for_input');

    agent.onDoContinue = async () => ({ success: true, state: 'completed', output: 'resumed' });
    const result = await agent.continue(makeContinuation(), makeContext());

    expect(result.success).toBe(true);
    expect(result.output).toBe('resumed');
    expect(agent.state).toBe('completed');
  });

  it('transitions to failed when doContinue throws', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    agent.onDoExecute = async () => ({
      success: true,
      state: 'waiting_for_input',
      output: '',
      pendingQuestion: { questionId: 'q1', text: 'Continue?', category: 'confirmation' },
    });
    await agent.execute(makeTask(), makeContext());

    agent.onDoContinue = async () => {
      throw new AgentError('continue-failure', 'execution', false);
    };
    const result = await agent.continue(makeContinuation(), makeContext());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('continue-failure');
    expect(agent.state).toBe('failed');
  });
});
