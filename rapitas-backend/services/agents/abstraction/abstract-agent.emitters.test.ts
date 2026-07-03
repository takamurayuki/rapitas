/**
 * abstract-agent.emitters.test
 *
 * Unit tests for AbstractAgent's protected event-emission helpers (emitOutput,
 * emitQuestion, emitArtifact, emitCommit, notifyToolExecution, updateMetrics),
 * plus log() and transitionState(). Split out from abstract-agent.helpers.test.ts
 * (stop/pause/resume/dispose/setLifecycleHooks) to stay under the 500-line cap.
 */
import { describe, it, expect } from 'bun:test';
import { AbstractAgent } from './abstract-agent';
import type { IAgentLogger, LogLevel } from './interfaces';
import type {
  AgentCapabilities,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentTaskDefinition,
  ContinuationContext,
  PendingQuestion,
  AgentArtifact,
  GitCommitInfo,
  ExecutionMetrics,
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

class FakeLogger implements IAgentLogger {
  calls: Array<{ method: string; args: unknown[] }> = [];
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    this.calls.push({ method: 'log', args: [level, message, context] });
  }
  debug(message: string, context?: Record<string, unknown>): void {
    this.calls.push({ method: 'debug', args: [message, context] });
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.calls.push({ method: 'info', args: [message, context] });
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.calls.push({ method: 'warn', args: [message, context] });
  }
  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.calls.push({ method: 'error', args: [message, error, context] });
  }
  child(): IAgentLogger {
    return this;
  }
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

  // Test-only public wrappers around protected members — avoids `any` casts.
  pubEmitOutput(content: string, isError?: boolean, isPartial?: boolean): Promise<void> {
    return this.emitOutput(content, isError, isPartial);
  }
  pubEmitQuestion(question: PendingQuestion): Promise<void> {
    return this.emitQuestion(question);
  }
  pubEmitArtifact(artifact: AgentArtifact): Promise<void> {
    return this.emitArtifact(artifact);
  }
  pubEmitCommit(commit: GitCommitInfo): Promise<void> {
    return this.emitCommit(commit);
  }
  pubNotifyToolExecution(toolId: string, toolName: string, input: unknown) {
    return this.notifyToolExecution(toolId, toolName, input);
  }
  pubUpdateMetrics(updates: Partial<ExecutionMetrics>): void {
    this.updateMetrics(updates);
  }
  pubLog(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    this.log(level, message, data);
  }
  pubTransitionState(newState: string, reason?: string): Promise<void> {
    return this.transitionState(newState, reason);
  }
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

// ──────────────────────────────────────────────────────────────────────────────
// emitOutput()
// ──────────────────────────────────────────────────────────────────────────────

describe('AbstractAgent — emitOutput()', () => {
  it('emits an output event with the given content and flags', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const outputs: Array<{ content: string; isError: boolean; isPartial: boolean }> = [];
    agent.events.on('output', async (event) => {
      const e = event as { content: string; isError: boolean; isPartial: boolean };
      outputs.push({ content: e.content, isError: e.isError, isPartial: e.isPartial });
    });

    await agent.pubEmitOutput('hello', true, true);

    expect(outputs).toEqual([{ content: 'hello', isError: true, isPartial: true }]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// emitQuestion()
// ──────────────────────────────────────────────────────────────────────────────

describe('AbstractAgent — emitQuestion()', () => {
  const question: PendingQuestion = { questionId: 'q1', text: 'ok?', category: 'confirmation' };

  it('does nothing when there is no active execution context', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    let fired = false;
    agent.events.on('question', async () => {
      fired = true;
    });

    await agent.pubEmitQuestion(question);

    expect(fired).toBe(false);
  });

  it('emits a question event and invokes onQuestion when a context is active', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const fired: PendingQuestion[] = [];
    const hookCalls: PendingQuestion[] = [];
    agent.events.on('question', async (event) => {
      const e = event as { question: PendingQuestion };
      fired.push(e.question);
    });
    agent.setLifecycleHooks({
      onQuestion: async (_ctx, q) => {
        hookCalls.push(q);
        return 'auto-answer';
      },
    });
    agent.onDoExecute = async function (this: TestAgent) {
      await this.pubEmitQuestion(question);
      return { success: true, state: 'completed', output: '' };
    }.bind(agent);

    await agent.execute(makeTask(), makeContext());

    expect(fired).toEqual([question]);
    expect(hookCalls).toEqual([question]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// emitArtifact()
// ──────────────────────────────────────────────────────────────────────────────

describe('AbstractAgent — emitArtifact()', () => {
  const artifact: AgentArtifact = { type: 'file', name: 'a.ts', content: 'x' };

  it('does nothing when there is no active execution context', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    let fired = false;
    agent.events.on('artifact', async () => {
      fired = true;
    });

    await agent.pubEmitArtifact(artifact);

    expect(fired).toBe(false);
  });

  it('emits an artifact event and invokes onArtifact when a context is active', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const hookCalls: AgentArtifact[] = [];
    agent.setLifecycleHooks({
      onArtifact: async (_ctx, a) => {
        hookCalls.push(a);
      },
    });
    agent.onDoExecute = async function (this: TestAgent) {
      await this.pubEmitArtifact(artifact);
      return { success: true, state: 'completed', output: '' };
    }.bind(agent);

    await agent.execute(makeTask(), makeContext());

    expect(hookCalls).toEqual([artifact]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// emitCommit()
// ──────────────────────────────────────────────────────────────────────────────

describe('AbstractAgent — emitCommit()', () => {
  it('emits a commit event regardless of active execution context', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const commit: GitCommitInfo = {
      hash: 'abc123',
      message: 'msg',
      branch: 'main',
      filesChanged: 1,
      additions: 1,
      deletions: 0,
    };
    const fired: GitCommitInfo[] = [];
    agent.events.on('commit', async (event) => {
      const e = event as { commit: GitCommitInfo };
      fired.push(e.commit);
    });

    await agent.pubEmitCommit(commit);

    expect(fired).toEqual([commit]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// notifyToolExecution()
// ──────────────────────────────────────────────────────────────────────────────

describe('AbstractAgent — notifyToolExecution()', () => {
  it('returns a no-op end() and does not emit when there is no active execution context', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    let fired = false;
    agent.events.on('tool_start', async () => {
      fired = true;
    });

    const { end } = await agent.pubNotifyToolExecution('t1', 'search', { q: 'x' });
    await expect(end('output', true)).resolves.toBeUndefined();

    expect(fired).toBe(false);
  });

  it('emits tool_start/tool_end and invokes before/afterToolCall hooks when active', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const starts: string[] = [];
    const ends: Array<{ success: boolean }> = [];
    agent.events.on('tool_start', async (event) => {
      const e = event as { toolName: string };
      starts.push(e.toolName);
    });
    agent.events.on('tool_end', async (event) => {
      const e = event as { success: boolean };
      ends.push({ success: e.success });
    });
    const afterToolCallArgs: Array<{ success: boolean; output: unknown }> = [];
    agent.setLifecycleHooks({
      afterToolCall: async (_ctx, _name, _input, output, success) => {
        afterToolCallArgs.push({ success, output });
      },
    });
    agent.onDoExecute = async function (this: TestAgent) {
      const { end } = await this.pubNotifyToolExecution('t1', 'search', { q: 'x' });
      await end('search-result', true);
      return { success: true, state: 'completed', output: '' };
    }.bind(agent);

    await agent.execute(makeTask(), makeContext());

    expect(starts).toEqual(['search']);
    expect(ends).toEqual([{ success: true }]);
    expect(afterToolCallArgs).toEqual([{ success: true, output: 'search-result' }]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// updateMetrics()
// ──────────────────────────────────────────────────────────────────────────────

describe('AbstractAgent — updateMetrics()', () => {
  it('is a no-op when there is no active metrics object', () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const fired: unknown[] = [];
    agent.events.on('metrics_update', async (event) => {
      fired.push(event);
    });

    agent.pubUpdateMetrics({ tokensUsed: 10 });

    expect(fired).toEqual([]);
  });

  it('merges updates into the active metrics and emits metrics_update during execution', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const fired: Array<Partial<ExecutionMetrics>> = [];
    agent.events.on('metrics_update', async (event) => {
      const e = event as { metrics: Partial<ExecutionMetrics> };
      fired.push(e.metrics);
    });
    agent.onDoExecute = async function (this: TestAgent) {
      this.pubUpdateMetrics({ tokensUsed: 42, toolCalls: 2 });
      return { success: true, state: 'completed', output: '' };
    }.bind(agent);

    const result = await agent.execute(makeTask(), makeContext());

    expect(fired).toEqual([{ tokensUsed: 42, toolCalls: 2 }]);
    expect(result.metrics?.tokensUsed).toBe(42);
    expect(result.metrics?.toolCalls).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// log()
// ──────────────────────────────────────────────────────────────────────────────

describe('AbstractAgent — log()', () => {
  it('appends an entry to the internal debug log', () => {
    const agent = new TestAgent('a', 'A', 'custom');
    agent.pubLog('info', 'hello world', { foo: 'bar' });

    const entries = agent.getDebugLogEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatchObject({
      level: 'info',
      message: 'hello world',
      data: { foo: 'bar' },
    });
  });

  it('routes through the injected logger when provided, branching error vs non-error', () => {
    const logger = new FakeLogger();
    const agent = new TestAgent('a', 'A', 'custom', { logger });

    agent.pubLog('warn', 'a warning', { code: 1 });
    agent.pubLog('error', 'an error');

    expect(logger.calls[0]).toMatchObject({
      method: 'warn',
      args: ['a warning', { data: { code: 1 }, agentId: 'a' }],
    });
    expect(logger.calls[1]).toMatchObject({
      method: 'error',
      args: ['an error', undefined, { agentId: 'a' }],
    });
  });

  it('falls back to the module pino logger when no logger is injected', () => {
    const agent = new TestAgent('a', 'A', 'custom');
    expect(() => agent.pubLog('debug', 'no injected logger')).not.toThrow();
    expect(agent.getDebugLogEntries().length).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// transitionState()
// ──────────────────────────────────────────────────────────────────────────────

describe('AbstractAgent — transitionState()', () => {
  it('emits state_change with previous/new state and reason, and invokes onStateChange when a context is active', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const stateChangeHookCalls: Array<{ from: string; to: string }> = [];
    agent.setLifecycleHooks({
      onStateChange: async (_ctx, previousState, newState) => {
        stateChangeHookCalls.push({ from: previousState, to: newState });
      },
    });
    agent.onDoExecute = async function (this: TestAgent) {
      await this.pubTransitionState('running', 'manual-note');
      return { success: true, state: 'completed', output: '' };
    }.bind(agent);

    await agent.execute(makeTask(), makeContext());

    // onStateChange fires for every transition the execute() lifecycle performs,
    // including the manual one triggered from inside doExecute.
    expect(stateChangeHookCalls).toContainEqual({ from: 'running', to: 'running' });
  });

  it('does not invoke onStateChange when there is no active execution context', async () => {
    const agent = new TestAgent('a', 'A', 'custom');
    const calls: unknown[] = [];
    agent.setLifecycleHooks({
      onStateChange: async () => {
        calls.push(1);
      },
    });

    await agent.pubTransitionState('running');

    expect(calls).toEqual([]);
  });
});
