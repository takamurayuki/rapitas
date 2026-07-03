/**
 * agent-service.continue.test
 *
 * Covers AgentService.continueExecution and AgentService.stopExecution: the
 * "not found" failure branches, ContinuationContext construction (sessionId
 * defaulting, workingDirectory fallback to getProjectRoot()), and the
 * terminal-vs-non-terminal cleanup branch shared with executeTask. See
 * agent-service.execute.test.ts and agent-service.shutdown.test.ts for the
 * rest of the file's coverage.
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
type ActiveExecution = ReturnType<InstanceType<typeof AgentService>['getActiveExecutions']>[number];
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
  const executeMock = mock(
    (): Promise<AgentExecutionResult> =>
      Promise.resolve({ success: true, state: 'completed', output: 'ok' }),
  );
  const continueMock = mock(
    (): Promise<AgentExecutionResult> =>
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

function seedActiveExecution(
  service: InstanceType<typeof AgentService>,
  executionId: string,
  execution: ActiveExecution,
): void {
  (service as unknown as { activeExecutions: Map<string, ActiveExecution> }).activeExecutions.set(
    executionId,
    execution,
  );
}

beforeEach(() => {
  resetRegistry();
  AgentService.resetInstance();
});

describe('AgentService.continueExecution', () => {
  test('returns a failure result when the execution id is unknown', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const result = await service.continueExecution('missing-exec', 'answer');
    expect(result).toEqual({
      success: false,
      state: 'failed',
      output: '',
      errorMessage: 'Execution missing-exec not found',
    });
  });

  test('returns a failure result when the execution is tracked but its agent is gone', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    seedActiveExecution(service, 'exec-1', {
      executionId: 'exec-1',
      agentId: 'ghost-agent',
      providerId: 'claude-code',
      state: 'waiting_for_input',
      startTime: new Date(),
      task: { id: 1, title: 't' },
    });

    const result = await service.continueExecution('exec-1', 'answer');
    expect(result).toEqual({
      success: false,
      state: 'failed',
      output: '',
      errorMessage: 'Agent ghost-agent not found',
    });
  });

  test('builds ContinuationContext with sessionId defaulting to executionId', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent, continueMock } = makeMutableAgent({ initialState: 'waiting_for_input' });
    agent.execute = mock(() =>
      Promise.resolve<AgentExecutionResult>({
        success: false,
        state: 'waiting_for_input',
        output: '',
      }),
    );
    service.registerProvider(makeProvider(agent));

    await service.executeTask({ id: 1, title: 't' }, { workingDirectory: '/x' });
    const [{ executionId }] = service.getActiveExecutions();

    await service.continueExecution(executionId, 'my answer');

    const [continuation] = continueMock.mock.calls[0];
    expect(continuation).toEqual({
      sessionId: executionId,
      previousExecutionId: executionId,
      userResponse: 'my answer',
    });
  });

  test('uses the given previousSessionId over the executionId when provided', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent, continueMock } = makeMutableAgent({ initialState: 'waiting_for_input' });
    agent.execute = mock(() =>
      Promise.resolve<AgentExecutionResult>({
        success: false,
        state: 'waiting_for_input',
        output: '',
      }),
    );
    service.registerProvider(makeProvider(agent));

    await service.executeTask({ id: 1, title: 't' }, { workingDirectory: '/x' });
    const [{ executionId }] = service.getActiveExecutions();

    await service.continueExecution(executionId, 'answer', 'prior-session-id');

    const [continuation] = continueMock.mock.calls[0];
    expect(continuation.sessionId).toBe('prior-session-id');
  });

  test('derives workingDirectory from task.constraints.allowedPaths[0] when present', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent, continueMock } = makeMutableAgent({ initialState: 'waiting_for_input' });
    agent.execute = mock(() =>
      Promise.resolve<AgentExecutionResult>({
        success: false,
        state: 'waiting_for_input',
        output: '',
      }),
    );
    service.registerProvider(makeProvider(agent));

    await service.executeTask(
      { id: 1, title: 't', constraints: { allowedPaths: ['/allowed/path'] } },
      { workingDirectory: '/x' },
    );
    const [{ executionId }] = service.getActiveExecutions();

    await service.continueExecution(executionId, 'answer');

    const [, context] = continueMock.mock.calls[0];
    expect(context.workingDirectory).toBe('/allowed/path');
  });

  test('falls back to getProjectRoot() when the task has no allowedPaths', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent, continueMock } = makeMutableAgent({ initialState: 'waiting_for_input' });
    agent.execute = mock(() =>
      Promise.resolve<AgentExecutionResult>({
        success: false,
        state: 'waiting_for_input',
        output: '',
      }),
    );
    service.registerProvider(makeProvider(agent));

    await service.executeTask({ id: 1, title: 't' }, { workingDirectory: '/x' });
    const [{ executionId }] = service.getActiveExecutions();

    await service.continueExecution(executionId, 'answer');

    const [, context] = continueMock.mock.calls[0];
    expect(context.workingDirectory).toBe('/repo');
  });

  test('removes the execution and disposes the agent when continue resolves to a terminal state', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent, continueMock, disposeMock } = makeMutableAgent({
      initialState: 'waiting_for_input',
    });
    agent.execute = mock(() =>
      Promise.resolve<AgentExecutionResult>({
        success: false,
        state: 'waiting_for_input',
        output: '',
      }),
    );
    continueMock.mockImplementation(async () =>
      Promise.resolve({ success: true, state: 'completed', output: 'resumed' }),
    );
    service.registerProvider(makeProvider(agent));

    await service.executeTask({ id: 1, title: 't' }, { workingDirectory: '/x' });
    const [{ executionId }] = service.getActiveExecutions();

    const result = await service.continueExecution(executionId, 'answer');

    expect(result.output).toBe('resumed');
    expect(service.getActiveExecutions()).toEqual([]);
    expect(disposeMock).toHaveBeenCalledTimes(1);
  });

  test('keeps the execution tracked when continue resolves to a non-terminal state', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent, continueMock, disposeMock } = makeMutableAgent({
      initialState: 'waiting_for_input',
    });
    agent.execute = mock(() =>
      Promise.resolve<AgentExecutionResult>({
        success: false,
        state: 'waiting_for_input',
        output: '',
      }),
    );
    continueMock.mockImplementation(async () =>
      Promise.resolve({ success: false, state: 'waiting_for_input', output: 'still waiting' }),
    );
    service.registerProvider(makeProvider(agent));

    await service.executeTask({ id: 1, title: 't' }, { workingDirectory: '/x' });
    const [{ executionId }] = service.getActiveExecutions();

    await service.continueExecution(executionId, 'answer');

    expect(service.getActiveExecutions()).toHaveLength(1);
    expect(disposeMock).not.toHaveBeenCalled();
  });
});

describe('AgentService.stopExecution', () => {
  test('returns false for an unknown execution id', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    expect(await service.stopExecution('missing')).toBe(false);
  });

  test('returns false and leaves the entry in place when the agent is already gone', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    seedActiveExecution(service, 'exec-1', {
      executionId: 'exec-1',
      agentId: 'ghost-agent',
      providerId: 'claude-code',
      state: 'running',
      startTime: new Date(),
      task: { id: 1, title: 't' },
    });

    expect(await service.stopExecution('exec-1')).toBe(false);
    expect(service.getExecutionStatus('exec-1')).not.toBeNull();
  });

  test('stops the agent, removes the execution, and disposes the agent on success', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent, stopMock, disposeMock } = makeMutableAgent({
      initialState: 'waiting_for_input',
    });
    agent.execute = mock(() =>
      Promise.resolve<AgentExecutionResult>({
        success: false,
        state: 'waiting_for_input',
        output: '',
      }),
    );
    service.registerProvider(makeProvider(agent));

    await service.executeTask({ id: 1, title: 't' }, { workingDirectory: '/x' });
    const [{ executionId }] = service.getActiveExecutions();

    expect(await service.stopExecution(executionId)).toBe(true);
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(disposeMock).toHaveBeenCalledTimes(1);
    expect(service.getActiveExecutions()).toEqual([]);
  });
});
