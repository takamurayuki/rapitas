/**
 * agent-service.shutdown.test
 *
 * Covers AgentService.shutdown (drains active executions, disposes every
 * agent, clears the initialized flag) and the module-level convenience
 * functions executeWithAgent / continueWithAgent, which delegate to the
 * shared `agentService` singleton export rather than a fresh instance.
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

const { AgentService, agentService, executeWithAgent, continueWithAgent } =
  await import('./agent-service');
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

beforeEach(() => {
  resetRegistry();
  AgentService.resetInstance();
});

describe('AgentService.shutdown', () => {
  test('stops every active execution, disposes all agents, and clears initialized', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const { agent, disposeMock } = makeMutableAgent({ initialState: 'waiting_for_input' });
    agent.execute = mock(() =>
      Promise.resolve<AgentExecutionResult>({
        success: false,
        state: 'waiting_for_input',
        output: '',
      }),
    );
    service.registerProvider(makeProvider(agent));

    await service.executeTask({ id: 1, title: 't' }, { workingDirectory: '/x' });
    expect(service.getActiveExecutions()).toHaveLength(1);

    await service.shutdown();

    expect(service.getActiveExecutions()).toEqual([]);
    expect(disposeMock).toHaveBeenCalledTimes(1);
    expect(service.getStats().initialized).toBe(false);
  });

  test('is a no-op-safe call when there is nothing running', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    await expect(service.shutdown()).resolves.toBeUndefined();
  });
});

describe('executeWithAgent / continueWithAgent module helpers', () => {
  test('executeWithAgent forwards providerId as selection criteria', async () => {
    const { agent } = makeMutableAgent({ providerId: 'claude-code' });
    agent.execute = mock(() =>
      Promise.resolve<AgentExecutionResult>({
        success: true,
        state: 'completed',
        output: 'via helper',
      }),
    );
    agentRegistry.registerProvider(makeProvider(agent));

    const result = await executeWithAgent(
      { id: 1, title: 'helper task' },
      { workingDirectory: '/x' },
      'claude-code',
    );
    expect(result.output).toBe('via helper');
  });

  test('executeWithAgent omits criteria entirely when providerId is not given', async () => {
    const { agent } = makeMutableAgent({ providerId: 'claude-code' });
    agentRegistry.registerProvider(makeProvider(agent));

    const result = await executeWithAgent(
      { id: 2, title: 'default provider' },
      { workingDirectory: '/x' },
    );
    expect(result.success).toBe(true);
  });

  test('continueWithAgent forwards executionId and userResponse to agentService.continueExecution', async () => {
    const { agent, continueMock } = makeMutableAgent({
      providerId: 'claude-code',
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
      Promise.resolve({ success: true, state: 'completed', output: 'resumed via helper' }),
    );
    agentRegistry.registerProvider(makeProvider(agent));

    await executeWithAgent({ id: 3, title: 'pauses' }, { workingDirectory: '/x' }, 'claude-code');
    const [execution] = agentService.getActiveExecutions();

    const result = await continueWithAgent(execution.executionId, 'go ahead');
    expect(result.output).toBe('resumed via helper');
    const [continuation] = continueMock.mock.calls[0];
    expect(continuation.userResponse).toBe('go ahead');
  });
});
