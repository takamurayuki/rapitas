/**
 * claude-code-agent-adapter.lifecycle.test
 *
 * Coverage for ClaudeCodeAgentAdapter.stop()/pause()/resume()/dispose(),
 * setLifecycleHooks() merge semantics, the metadata/capabilities/events
 * getters, and the onStateChange dummy-context hook path. execute()/
 * continue() paths live in claude-code-agent-adapter.test.ts (300-500 line
 * file-size policy).
 *
 * The legacy `ClaudeCodeAgent` is mocked end-to-end so no CLI process is ever
 * spawned. `../../claude-code-agent` only exports the `ClaudeCodeAgent` class
 * at runtime (`ClaudeCodeAgentConfig` is a type-only export), so the mock
 * factory below is a complete mirror.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type {
  AgentTask,
  AgentExecutionResult as LegacyExecutionResult,
  QuestionDetectedHandler,
  AgentOutputHandler,
} from '../../base-agent';

// ── legacy ClaudeCodeAgent mock ─────────────────────────────────────────────

let nextExecuteResult: LegacyExecutionResult = { success: true, output: 'done' };
/** When true, execute() returns a promise that never settles — used to hold
 * the adapter in the 'running' state so stop()/pause() mid-execution can be
 * exercised deterministically without racing a real timer. */
let hangExecute = false;
let nextPauseResult = true;
let nextResumeResult = true;
let stopCalls = 0;

class MockClaudeCodeAgent {
  outputHandler: AgentOutputHandler | null = null;
  questionHandler: QuestionDetectedHandler | null = null;

  constructor(
    public id: string,
    public name: string,
    public config: Record<string, unknown>,
  ) {}

  setOutputHandler(handler: AgentOutputHandler): void {
    this.outputHandler = handler;
  }

  setQuestionDetectedHandler(handler: QuestionDetectedHandler): void {
    this.questionHandler = handler;
  }

  async execute(_task: AgentTask): Promise<LegacyExecutionResult> {
    if (hangExecute) return new Promise<LegacyExecutionResult>(() => {});
    return nextExecuteResult;
  }

  async stop(): Promise<void> {
    stopCalls += 1;
  }
  async pause(): Promise<boolean> {
    return nextPauseResult;
  }
  async resume(): Promise<boolean> {
    return nextResumeResult;
  }
}

mock.module('../../claude-code-agent', () => ({
  ClaudeCodeAgent: MockClaudeCodeAgent,
}));

const { ClaudeCodeAgentAdapter } = await import('./claude-code-agent-adapter');
import type {
  AgentExecutionContext,
  AgentState,
  AgentTaskDefinition,
  ClaudeCodeProviderConfig,
} from '../types';

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ClaudeCodeProviderConfig> = {}): ClaudeCodeProviderConfig {
  return { providerId: 'claude-code', enabled: true, ...overrides };
}

function makeContext(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return { executionId: 'exec-1', workingDirectory: '/tmp/work', ...overrides };
}

function makeTask(overrides: Partial<AgentTaskDefinition> = {}): AgentTaskDefinition {
  return { id: 1, title: 'Test task', ...overrides };
}

/** Flushes pending microtasks so an in-flight execute() reaches its 'running' await point. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Drives the adapter into 'running' with a live (never-resolving) legacy execute() call. */
async function driveToRunning(adapter: InstanceType<typeof ClaudeCodeAgentAdapter>): Promise<void> {
  hangExecute = true;
  void adapter.execute(makeTask(), makeContext());
  await flush();
}

beforeEach(() => {
  nextExecuteResult = { success: true, output: 'done' };
  hangExecute = false;
  nextPauseResult = true;
  nextResumeResult = true;
  stopCalls = 0;
});

// ── stop() ───────────────────────────────────────────────────────────────────

describe('ClaudeCodeAgentAdapter.stop', () => {
  test('is a no-op for a fresh idle adapter', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    await adapter.stop();
    expect(adapter.state).toBe('idle');
    expect(stopCalls).toBe(0);
  });

  test('is a no-op once the adapter has completed', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    await adapter.execute(makeTask(), makeContext());
    expect(adapter.state).toBe('completed');

    await adapter.stop();

    expect(adapter.state).toBe('completed');
    expect(stopCalls).toBe(0);
  });

  test('is a no-op once the adapter has failed', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    nextExecuteResult = { success: false, output: '', errorMessage: 'boom' };
    await adapter.execute(makeTask(), makeContext());
    expect(adapter.state).toBe('failed');

    await adapter.stop();

    expect(adapter.state).toBe('failed');
    expect(stopCalls).toBe(0);
  });

  test('stops the legacy agent and transitions to cancelled while running', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    await driveToRunning(adapter);
    expect(adapter.state).toBe('running');

    await adapter.stop();

    expect(stopCalls).toBe(1);
    expect(adapter.state).toBe('cancelled');
  });
});

// ── pause() / resume() ───────────────────────────────────────────────────────

describe('ClaudeCodeAgentAdapter.pause / resume', () => {
  test('pause() returns false when not running', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    expect(await adapter.pause()).toBe(false);
    expect(adapter.state).toBe('idle');
  });

  test('pause() transitions to paused when the legacy agent pauses successfully', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    await driveToRunning(adapter);
    nextPauseResult = true;

    expect(await adapter.pause()).toBe(true);
    expect(adapter.state).toBe('paused');
  });

  test('pause() stays running when the legacy agent refuses to pause', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    await driveToRunning(adapter);
    nextPauseResult = false;

    expect(await adapter.pause()).toBe(false);
    expect(adapter.state).toBe('running');
  });

  test('resume() returns false when not paused', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    expect(await adapter.resume()).toBe(false);
    expect(adapter.state).toBe('idle');
  });

  test('resume() transitions back to running when the legacy agent resumes successfully', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    await driveToRunning(adapter);
    nextPauseResult = true;
    await adapter.pause();
    expect(adapter.state).toBe('paused');

    nextResumeResult = true;
    expect(await adapter.resume()).toBe(true);
    expect(adapter.state).toBe('running');
  });

  test('resume() stays paused when the legacy agent refuses to resume', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    await driveToRunning(adapter);
    nextPauseResult = true;
    await adapter.pause();

    nextResumeResult = false;
    expect(await adapter.resume()).toBe(false);
    expect(adapter.state).toBe('paused');
  });
});

// ── dispose() ────────────────────────────────────────────────────────────────

describe('ClaudeCodeAgentAdapter.dispose', () => {
  test('is idempotent for an idle adapter', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    await adapter.dispose();
    await adapter.dispose();
    expect(adapter.state).toBe('idle');
  });

  test('stops a running execution first, then resets state to idle', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    await driveToRunning(adapter);

    await adapter.dispose();

    expect(stopCalls).toBe(1);
    // NOTE: dispose() sets _state = 'idle' directly (not via transitionState)
    // after stop() has already moved it to 'cancelled' — 'idle' is the final,
    // observable post-dispose state.
    expect(adapter.state).toBe('idle');
  });

  test('removes all event listeners', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    adapter.events.on('state_change', () => {});
    expect(adapter.events.listenerCount()).toBeGreaterThan(0);

    await adapter.dispose();

    expect(adapter.events.listenerCount()).toBe(0);
  });

  test('causes subsequent execute() calls to reject', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    await adapter.dispose();

    await expect(adapter.execute(makeTask(), makeContext())).rejects.toThrow(
      'Agent has been disposed',
    );
  });
});

// ── setLifecycleHooks() ──────────────────────────────────────────────────────

describe('ClaudeCodeAgentAdapter.setLifecycleHooks', () => {
  test('merges successive partial hook updates instead of replacing them', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    const beforeExecute = mock(
      async (_ctx: AgentExecutionContext, _task: AgentTaskDefinition) => true,
    );
    const afterExecute = mock(async () => {});
    adapter.setLifecycleHooks({ beforeExecute });
    adapter.setLifecycleHooks({ afterExecute });

    await adapter.execute(makeTask(), makeContext());

    expect(beforeExecute).toHaveBeenCalledTimes(1);
    expect(afterExecute).toHaveBeenCalledTimes(1);
  });
});

// ── getters ──────────────────────────────────────────────────────────────────

describe('ClaudeCodeAgentAdapter getters', () => {
  test('metadata and capabilities are defensive copies; events is a stable reference', () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());

    expect(adapter.metadata).not.toBe(adapter.metadata);
    expect(adapter.metadata).toEqual(adapter.metadata);
    expect(adapter.capabilities).not.toBe(adapter.capabilities);
    expect(adapter.capabilities).toEqual(adapter.capabilities);
    expect(adapter.events).toBe(adapter.events);
  });

  test('capabilities report parallelExecution=false and other CLI flags true', () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());

    expect(adapter.capabilities.parallelExecution).toBe(false);
    expect(adapter.capabilities.codeGeneration).toBe(true);
    expect(adapter.capabilities.sessionContinuation).toBe(true);
    expect(adapter.capabilities.questionAsking).toBe(true);
  });

  test('metadata carries a claude-code providerId and an id-derived name', () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());

    expect(adapter.metadata.providerId).toBe('claude-code');
    expect(adapter.metadata.name).toContain(adapter.metadata.id);
    expect(adapter.metadata.lastUsedAt).toBeUndefined();
  });
});

// ── onStateChange hook (dummy execution context) ────────────────────────────

describe('ClaudeCodeAgentAdapter onStateChange hook', () => {
  test('is invoked once per transition with a synthetic execution context', async () => {
    const adapter = new ClaudeCodeAgentAdapter(makeConfig());
    const onStateChange = mock(
      async (_ctx: AgentExecutionContext, _prev: AgentState, _next: AgentState) => {},
    );
    adapter.setLifecycleHooks({ onStateChange });

    await adapter.execute(makeTask(), makeContext());

    // idle->initializing, initializing->running, running->completed
    expect(onStateChange).toHaveBeenCalledTimes(3);
    const [ctx, prev, next] = onStateChange.mock.calls[0]!;
    expect(ctx.executionId).toBe('state-change');
    expect(ctx.workingDirectory).toBe(process.cwd());
    expect(prev).toBe('idle');
    expect(next).toBe('initializing');
  });
});
