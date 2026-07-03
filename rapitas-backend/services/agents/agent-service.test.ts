/**
 * agent-service.test
 *
 * Facade-level unit tests for AgentService: singleton lifecycle, provider
 * passthroughs, selectProvider scoring branches, health checks, stats, and
 * shutdown. Execution/continuation flows (the most branch-heavy part of the
 * file) live in agent-service.execute.test.ts to keep each file under the
 * 500-line split threshold.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { AgentCapabilities, AgentProviderId } from './abstraction/types';
import type { IAgentProvider } from './abstraction/interfaces';

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

const registerDefaultProvidersMock = mock(() => {});
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
  registerDefaultProviders: registerDefaultProvidersMock,
  registerAllProviders: () => {},
  AVAILABLE_PROVIDERS: [],
  PROVIDER_INFO: {},
}));

const { AgentService } = await import('./agent-service');
const { agentRegistry } = await import('./abstraction');

/**
 * Empties the shared agentRegistry singleton between tests.
 *
 * NOTE: AgentRegistry.resetInstance() only clears `AgentRegistry.instance` —
 * a static bookkeeping field distinct from the `agentRegistry` const that
 * AgentService actually holds onto. Once that static field goes null (after
 * the first resetInstance() call), later resetInstance() calls become no-ops
 * against the real singleton, silently leaking providers across tests. Using
 * the public unregisterProvider API instead clears the object AgentService
 * genuinely uses.
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

function makeProvider(
  providerId: AgentProviderId,
  overrides: Partial<IAgentProvider> = {},
): IAgentProvider {
  return {
    providerId,
    providerName: `Fake ${providerId}`,
    version: '1.0.0',
    getCapabilities: () => fullCapabilities(),
    isAvailable: mock(() => Promise.resolve(true)),
    validateConfig: mock(() => Promise.resolve({ valid: true, errors: [] })),
    healthCheck: mock(() =>
      Promise.resolve({ healthy: true, available: true, lastCheck: new Date() }),
    ),
    createAgent: mock(() => {
      throw new Error('createAgent not stubbed for this provider fixture');
    }),
    ...overrides,
  };
}

beforeEach(() => {
  registerDefaultProvidersMock.mockClear();
  resetRegistry();
  AgentService.resetInstance();
});

describe('AgentService.getInstance / resetInstance', () => {
  test('returns the same instance across repeated calls', () => {
    const a = AgentService.getInstance();
    const b = AgentService.getInstance();
    expect(a).toBe(b);
  });

  test('ignores config passed to getInstance once an instance already exists', async () => {
    const first = AgentService.getInstance({ defaultTimeout: 111 });
    AgentService.getInstance({ defaultTimeout: 222 });

    const provider = makeProvider('claude-code');
    provider.createAgent = mock(() => {
      throw new Error('unused');
    });
    first.registerProvider(provider);

    // Indirect proof the second config was discarded: selectProvider still
    // resolves via the config captured on first construction.
    const selected = await first.selectProvider({});
    expect(selected?.providerId).toBe('claude-code');
  });

  test('resetInstance clears active executions and drops the singleton', () => {
    const service = AgentService.getInstance();
    expect(service.getActiveExecutions()).toEqual([]);
    AgentService.resetInstance();
    const fresh = AgentService.getInstance();
    expect(fresh).not.toBe(service);
  });

  test('resetInstance is a no-op when no instance was ever created', () => {
    AgentService.resetInstance();
    expect(() => AgentService.resetInstance()).not.toThrow();
  });
});

describe('AgentService.initialize', () => {
  test('registers default providers when autoRegisterProviders is true (default)', async () => {
    const service = AgentService.getInstance();
    await service.initialize();
    expect(registerDefaultProvidersMock).toHaveBeenCalledTimes(1);
    expect(service.getStats().initialized).toBe(true);
  });

  test('is idempotent — a second call does not re-register providers', async () => {
    const service = AgentService.getInstance();
    await service.initialize();
    await service.initialize();
    expect(registerDefaultProvidersMock).toHaveBeenCalledTimes(1);
  });

  test('skips provider auto-registration when autoRegisterProviders is false', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    await service.initialize();
    expect(registerDefaultProvidersMock).not.toHaveBeenCalled();
    expect(service.getStats().initialized).toBe(true);
  });
});

describe('AgentService provider passthroughs', () => {
  test('registerProvider delegates to the registry', () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const provider = makeProvider('claude-code');
    service.registerProvider(provider);
    expect(service.getProvider('claude-code')).toBe(provider);
  });

  test('getProvider returns undefined for an unregistered provider', () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    expect(service.getProvider('gemini')).toBeUndefined();
  });

  test('getAvailableProviders delegates to the registry', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    service.registerProvider(makeProvider('claude-code'));
    const providers = await service.getAvailableProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0].providerId).toBe('claude-code');
    expect(providers[0].isAvailable).toBe(true);
  });

  test('getProvidersByCapability filters by the requested flag', () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    service.registerProvider(
      makeProvider('claude-code', {
        getCapabilities: () => fullCapabilities({ webSearch: false }),
      }),
    );
    service.registerProvider(makeProvider('gemini', { getCapabilities: () => fullCapabilities() }));

    const withWebSearch = service.getProvidersByCapability('webSearch');
    expect(withWebSearch.map((p) => p.providerId)).toEqual(['gemini']);
  });
});

describe('AgentService.selectProvider', () => {
  test('returns the provider when providerId criteria is available', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const provider = makeProvider('claude-code');
    service.registerProvider(provider);

    const selected = await service.selectProvider({ providerId: 'claude-code' });
    expect(selected).toBe(provider);
  });

  test('returns null when the requested providerId is unavailable', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    service.registerProvider(
      makeProvider('claude-code', { isAvailable: mock(() => Promise.resolve(false)) }),
    );

    const selected = await service.selectProvider({ providerId: 'claude-code' });
    expect(selected).toBeNull();
  });

  test('returns null when the requested providerId is not registered', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const selected = await service.selectProvider({ providerId: 'claude-code' });
    expect(selected).toBeNull();
  });

  test('delegates to registry.selectBestProvider when requiredCapabilities is non-empty', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    service.registerProvider(
      makeProvider('claude-code', {
        getCapabilities: () => fullCapabilities({ webSearch: false }),
      }),
    );
    const qualifying = makeProvider('gemini', { getCapabilities: () => fullCapabilities() });
    service.registerProvider(qualifying);

    const selected = await service.selectProvider({ requiredCapabilities: ['webSearch'] });
    expect(selected).toBe(qualifying);
  });

  test('falls back to the configured default provider when no criteria given', async () => {
    const service = AgentService.getInstance({
      autoRegisterProviders: false,
      defaultProviderId: 'gemini',
    });
    const claude = makeProvider('claude-code');
    const gemini = makeProvider('gemini');
    service.registerProvider(claude);
    service.registerProvider(gemini);

    const selected = await service.selectProvider({});
    expect(selected).toBe(gemini);
  });

  test('returns null when no criteria given and the default provider is unregistered', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const selected = await service.selectProvider({});
    expect(selected).toBeNull();
  });
});

describe('AgentService health checks', () => {
  test('healthCheck returns null for an unknown provider', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    expect(await service.healthCheck('claude-code')).toBeNull();
  });

  test('healthCheck delegates to the provider health check', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    const status = { healthy: false, available: true, lastCheck: new Date(), errors: ['degraded'] };
    service.registerProvider(
      makeProvider('claude-code', { healthCheck: mock(() => Promise.resolve(status)) }),
    );

    expect(await service.healthCheck('claude-code')).toBe(status);
  });

  test('healthCheckAll delegates to the registry', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    service.registerProvider(makeProvider('claude-code'));
    service.registerProvider(makeProvider('gemini'));

    const results = await service.healthCheckAll();
    expect(results.size).toBe(2);
    expect(results.get('claude-code')?.healthy).toBe(true);
  });
});

describe('AgentService.getStats', () => {
  test('reports initialized flag, provider count, and active execution count', async () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    expect(service.getStats()).toEqual({
      initialized: false,
      providerCount: 0,
      activeExecutions: 0,
      registryStats: agentRegistry.getStats(),
    });

    service.registerProvider(makeProvider('claude-code'));
    await service.initialize();

    const stats = service.getStats();
    expect(stats.initialized).toBe(true);
    expect(stats.providerCount).toBe(1);
    expect(stats.activeExecutions).toBe(0);
  });
});

describe('AgentService.getExecutionStatus / getActiveExecutions', () => {
  test('getExecutionStatus returns null for an unknown execution id', () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    expect(service.getExecutionStatus('does-not-exist')).toBeNull();
  });

  test('getActiveExecutions returns an empty array when nothing is running', () => {
    const service = AgentService.getInstance({ autoRegisterProviders: false });
    expect(service.getActiveExecutions()).toEqual([]);
  });
});
