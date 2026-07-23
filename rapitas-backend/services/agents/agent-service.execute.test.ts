/**
 * agent-service.execute.test
 *
 * Covers AgentService.executeTask: provider selection wiring, context
 * construction, state-change subscription, and the two independent
 * terminal-state checks (result state controls active-execution cleanup;
 * agent.state controls disposal). continueExecution/stopExecution/shutdown
 * and the module-level helpers live in sibling agent-service.*.test.ts files
 * to keep each file under the 500-line split threshold.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type {
  AgentCapabilities,
  AgentProviderId,
  AgentState,
  AgentExecutionResult,
} from './abstraction/types';
import type { IAgent, IAgentProvider } from './abstraction/interfaces';

// HACK(agent): bun:test's mock.module is process-global, so every real export
// of a mocked module must be mirrored — otherwise a later import in the same
// process throws "export not found".
mock.module('../../config/logger', () => {
  const noop = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    fatal: () => {},
  };
  return {
    createLogger: () => noop,
    logger: noop,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});
mock.module('../../config', () => {
  const noop = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    fatal: () => {},
  };
  return {
    prisma: {},
    ensureDatabaseConnection: () => Promise.resolve(),
    logger: noop,
    createLogger: () => noop,
    getDbProvider: () => 'postgresql',
    getInsensitiveMode: () => 'default',
    getProjectRoot: () => '/repo',
  };
});
mock.module('./providers', () => ({
  ClaudeCodeProvider: class {},
  ClaudeCodeAgentV2: class {},
  claudeCodeProvider: {},
  AnthropicApiProvider: class {},
  AnthropicApiAgent: class {},
  anthropicApiProvider: {},
  CLAUDE_MODELS: {},
  OpenAIProvider: class {},
  OpenAIAgent: class {},
  openaiProvider: {},
  OPENAI_MODELS: {},
  GeminiProvider: class {},
  GeminiAgent: class {},
  geminiProvider: {},
  GEMINI_MODELS: {},
  GeminiCliProvider: class {},
  GeminiCliAgentV2: class {},
  geminiCliProvider: {},
  registerDefaultProviders: () => {},
  registerAllProviders: () => {},
  AVAILABLE_PROVIDERS: [],
  PROVIDER_INFO: {},
}));

const { AgentService } = await import('./agent-service');
const { agentRegistry, AgentEventEmitter } = await import('./abstraction');

/**
 * Empties the shared agentRegistry singleton between tests.
 *
 * NOTE: AgentRegistry.resetInstance() only clears the static `instance`
 * bookkeeping field, not the `agentRegistry` const that AgentService actually
 * holds — after the first call it becomes a no-op against the real singleton
 * and providers leak across tests. unregisterProvider clears the object
 * AgentService genuinely uses.
 */
function resetRegistry(): void {
  for (const provider of agentRegistry.getAllProviders()) {
    agentRegistry.unregisterProvider(provider.providerId);
  }
}

function fullCapabilities(overrides: Partial<AgentCapabilities> = {}): AgentCapabilities {
  return {
    codeGeneration: true,
    codeReview: true,
    codeExecution: true,
    fileRead: true,
    fileWrite: true,
    fileEdit: true,
    terminalAccess: true,
    gitOperations: true,
    webSearch: true,
    webFetch: true,
    taskAnalysis: true,
    taskPlanning: true,
    parallelExecution: true,
    questionAsking: true,
    conversationMemory: true,
    sessionContinuation: true,
    ...overrides,
  };
}

/** Builds a fully-controllable fake IAgent: mutable state, spy-able execute/continue/dispose. */
function makeMutableAgent(
  opts: { id?: string; providerId?: AgentProviderId; initialState?: AgentState } = {},
) {
  let state: AgentState = opts.initialState ?? 'idle';
  const events = new AgentEventEmitter(opts.id ?? 'agent-1');
  const executeMock = mock((): Promise<AgentExecutionResult> =>
    Promise.resolve({ success: true, state: 'completed', output: 'ok' }),
  );
  const continueMock = mock((): Promise<AgentExecutionResult> =>
    Promise.resolve({ success: true, state: 'completed', output: 'ok' }),
  );
  const stopMock = mock(() => Promise.resolve());
  const disposeMock = mock(() => Promise.resolve());
  const agent: IAgent = {
    metadata: {
      id: opts.id ?? 'agent-1',
      providerId: opts.providerId ?? 'claude-code',
      name: 'Fake Agent',
      createdAt: new Date(),
    },
    get state() {
      return state;
    },
    capabilities: fullCapabilities(),
    events,
    execute: executeMock,
    continue: continueMock,
    stop: stopMock,
    pause: mock(() => Promise.resolve(true)),
    resume: mock(() => Promise.resolve(true)),
    setLifecycleHooks: mock(() => {}),
    dispose: disposeMock,
  };
  return {
    agent,
    events,
    setState: (s: AgentState) => {
      state = s;
    },
    executeMock,
    continueMock,
    stopMock,
    disposeMock,
  };
}

function makeProvider(agent: IAgent, overrides: Partial<IAgentProvider> = {}): IAgentProvider {
  return {
    providerId: agent.metadata.providerId,
    providerName: 'Fake Provider',
    version: '1.0.0',
    getCapabilities: () => fullCapabilities(),
    isAvailable: mock(() => Promise.resolve(true)),
    validateConfig: mock(() => Promise.resolve({ valid: true, errors: [] })),
    healthCheck: mock(() =>
      Promise.resolve({ healthy: true, available: true, lastCheck: new Date() }),
    ),
    createAgent: mock(() => agent),
    ...overrides,
  };
}

beforeEach(() => {
  resetRegistry();
  AgentService.resetInstance();
});

describe('AgentService.executeTask', () => {
  test('returns a failed result immediately when no provider is available', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const result = await service.executeTask(
      { id: 1, title: 'no provider' },
      { workingDirectory: '/x' },
    );

    expect(result).toEqual({
      success: false,
      state: 'failed',
      output: '',
      errorMessage: 'No available provider found',
    });
    expect(service.getActiveExecutions()).toEqual([]);
  });

  test('calls ensureInitialized so an unused service is initialized as a side effect', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent } = makeMutableAgent();
    service.registerProvider(makeProvider(agent));

    expect(service.getStats().initialized).toBe(false);
    await service.executeTask({ id: 1, title: 't' }, { workingDirectory: '/x' });
    expect(service.getStats().initialized).toBe(true);
  });

  test('builds agent context from options, applying the configured default timeout when omitted', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false, defaultTimeout: 42 });
    const { agent, executeMock } = makeMutableAgent();
    service.registerProvider(makeProvider(agent));

    await service.executeTask({ id: 1, title: 't' }, { workingDirectory: '/work' });

    const [, context] = executeMock.mock.calls[0];
    expect(context.workingDirectory).toBe('/work');
    expect(context.timeout).toBe(42);
    expect(context.autoApprove).toBeUndefined();
    expect(context.verbose).toBeUndefined();
  });

  test('passes explicit timeout, autoApprove, verbose, and metadata through to the context', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent, executeMock } = makeMutableAgent();
    service.registerProvider(makeProvider(agent));

    await service.executeTask(
      { id: 1, title: 't' },
      {
        workingDirectory: '/work',
        timeout: 5000,
        autoApprove: true,
        verbose: true,
        metadata: { a: 1 },
      },
    );

    const [, context] = executeMock.mock.calls[0];
    expect(context.timeout).toBe(5000);
    expect(context.autoApprove).toBe(true);
    expect(context.verbose).toBe(true);
    expect(context.metadata).toEqual({ a: 1 });
  });

  test('routes execution through the provider selected by criteria.providerId, not the configured default', async () => {
    const service = AgentService.getInstance({
      autoRegisterProviders: false,
      defaultProviderId: 'gemini',
    });
    const { agent: claudeAgent, executeMock: claudeExecute } = makeMutableAgent({
      providerId: 'claude-code',
    });
    const { agent: geminiAgent, executeMock: geminiExecute } = makeMutableAgent({
      providerId: 'gemini',
    });
    service.registerProvider(makeProvider(claudeAgent));
    service.registerProvider(makeProvider(geminiAgent));

    const result = await service.executeTask(
      { id: 1, title: 't' },
      { workingDirectory: '/x' },
      { providerId: 'claude-code' },
    );

    expect(result.success).toBe(true);
    expect(claudeExecute).toHaveBeenCalledTimes(1);
    expect(geminiExecute).not.toHaveBeenCalled();
  });

  test('updates the tracked execution state as the agent emits state_change events', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent, executeMock } = makeMutableAgent({ initialState: 'running' });
    service.registerProvider(makeProvider(agent));

    let observedState: AgentState | undefined;
    executeMock.mockImplementation(async (_task, context) => {
      await agent.events.emitStateChange('initializing', 'running');
      observedState = service.getExecutionStatus(context.executionId)?.state;
      return { success: true, state: 'completed', output: 'done' };
    });

    await service.executeTask({ id: 1, title: 't' }, { workingDirectory: '/x' });
    expect(observedState).toBe('running');
  });

  test('deletes the active execution when the result state is terminal', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent } = makeMutableAgent({ initialState: 'completed' });
    service.registerProvider(makeProvider(agent));

    await service.executeTask({ id: 1, title: 't' }, { workingDirectory: '/x' });
    expect(service.getActiveExecutions()).toEqual([]);
  });

  test('keeps the active execution entry when the result state is non-terminal', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent, executeMock } = makeMutableAgent({ initialState: 'waiting_for_input' });
    executeMock.mockImplementation(async () =>
      Promise.resolve({ success: false, state: 'waiting_for_input', output: '' }),
    );
    service.registerProvider(makeProvider(agent));

    await service.executeTask({ id: 7, title: 'pending' }, { workingDirectory: '/x' });

    const active = service.getActiveExecutions();
    expect(active).toHaveLength(1);
    expect(active[0].providerId).toBe('claude-code');
    // Tracked state only changes via state_change events (see the dedicated
    // "updates the tracked execution state" test) — it is not derived from
    // the execute() result, so it stays at its initial value here.
    expect(active[0].state).toBe('initializing');
    expect(active[0].task.id).toBe(7);
    expect(active[0].startTime).toBeInstanceOf(Date);
  });

  test('disposes the agent when its own state is terminal after execute, independent of result state', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent, executeMock, disposeMock, setState } = makeMutableAgent({
      initialState: 'running',
    });
    executeMock.mockImplementation(async () => {
      // Agent transitions to a terminal state on its own even though the
      // reported result state is non-terminal — the dispose check reads
      // agent.state, not result.state, so this must still trigger disposal.
      setState('completed');
      return { success: false, state: 'waiting_for_input', output: '' };
    });
    service.registerProvider(makeProvider(agent));

    await service.executeTask({ id: 1, title: 't' }, { workingDirectory: '/x' });

    expect(disposeMock).toHaveBeenCalledTimes(1);
    // The active-execution map key is independent of the dispose check: the
    // non-terminal *result* state means the entry is retained even though the
    // underlying agent was disposed.
    expect(service.getActiveExecutions()).toHaveLength(1);
  });

  test('does not dispose the agent when its state is non-terminal, even if the result is terminal', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent, disposeMock } = makeMutableAgent({ initialState: 'running' });
    service.registerProvider(makeProvider(agent));

    await service.executeTask({ id: 1, title: 't' }, { workingDirectory: '/x' });

    expect(disposeMock).not.toHaveBeenCalled();
    expect(service.getActiveExecutions()).toEqual([]);
  });

  test('unsubscribes the state_change listener once execution finishes', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent, events } = makeMutableAgent({ initialState: 'completed' });
    service.registerProvider(makeProvider(agent));

    await service.executeTask({ id: 1, title: 't' }, { workingDirectory: '/x' });
    expect(events.listenerCount('state_change')).toBe(0);
  });

  test('propagates a rejection from agent.execute while still running finally-block cleanup', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent, executeMock, disposeMock, events, setState } = makeMutableAgent({
      initialState: 'running',
    });
    executeMock.mockImplementation(async () => {
      setState('failed');
      throw new Error('boom');
    });
    service.registerProvider(makeProvider(agent));

    await expect(
      service.executeTask({ id: 1, title: 't' }, { workingDirectory: '/x' }),
    ).rejects.toThrow('boom');

    // finally still unsubscribes and disposes (agent.state is terminal 'failed').
    expect(events.listenerCount('state_change')).toBe(0);
    expect(disposeMock).toHaveBeenCalledTimes(1);
    // The map delete only happens on the (never-reached) success path, so the
    // execution record is left behind after a thrown error.
    expect(service.getActiveExecutions()).toHaveLength(1);
  });
});
