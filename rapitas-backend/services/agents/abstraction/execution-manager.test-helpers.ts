/**
 * execution-manager.test-helpers
 *
 * Shared fixtures for the execution-manager.*.test.ts suite: a minimal fake
 * IAgent/IAgentProvider pair registered against the real AgentRegistry
 * singleton, plus a sync-timer shim so post-completion cleanup (normally
 * scheduled 60s out) can be asserted without a real wait.
 */
import { mock } from 'bun:test';
import { AgentRegistry } from './registry';
import { AgentEventEmitter } from './event-emitter';
import type { IAgent, IAgentProvider } from './interfaces';
import type {
  AgentCapabilities,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentMetadata,
  AgentProviderConfig,
  AgentState,
} from './types';

export const capabilities: AgentCapabilities = {
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

export function makeResult(overrides: Partial<AgentExecutionResult> = {}): AgentExecutionResult {
  return {
    success: true,
    state: 'completed',
    output: 'done',
    ...overrides,
  };
}

/** Minimal fake IAgent backed by a real AgentEventEmitter so `.events.on()` works as-is. */
export function makeFakeAgent(
  id: string,
  overrides: Partial<IAgent> = {},
): IAgent & {
  execute: ReturnType<typeof mock>;
  continue: ReturnType<typeof mock>;
  stop: ReturnType<typeof mock>;
} {
  const metadata: AgentMetadata = {
    id,
    providerId: 'custom',
    name: `agent-${id}`,
    createdAt: new Date(),
  };

  return {
    metadata,
    state: 'idle' as AgentState,
    capabilities,
    events: new AgentEventEmitter(id),
    execute: mock(async () => makeResult()),
    continue: mock(async () => makeResult()),
    stop: mock(async () => {}),
    pause: mock(async () => true),
    resume: mock(async () => true),
    setLifecycleHooks: mock(() => {}),
    dispose: mock(async () => {}),
    ...overrides,
  } as IAgent & {
    execute: ReturnType<typeof mock>;
    continue: ReturnType<typeof mock>;
    stop: ReturnType<typeof mock>;
  };
}

/** Registers `agent` in the (real) AgentRegistry singleton behind a stub provider. */
export function registerFakeAgent(agent: IAgent): void {
  const registry = AgentRegistry.getInstance();
  const provider: IAgentProvider = {
    providerId: 'custom',
    providerName: 'Test Provider',
    version: '1.0.0',
    getCapabilities: () => capabilities,
    isAvailable: async () => true,
    validateConfig: async () => ({ valid: true, errors: [] }),
    healthCheck: async () => ({
      healthy: true,
      available: true,
      errors: [],
      lastCheck: new Date(),
    }),
    createAgent: () => agent,
  };
  registry.registerProvider(provider);
  registry.createAgent({ providerId: 'custom', enabled: true } as AgentProviderConfig);
}

export function makeContext(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return {
    executionId: '',
    workingDirectory: '/tmp/work',
    ...overrides,
  };
}

/** Replaces global setTimeout so scheduled cleanups run synchronously (no real 60s wait). */
export function useSyncTimers(): () => void {
  const original = globalThis.setTimeout;
  // NOTE: cast is required — the native setTimeout overload set (string|Function
  // first arg, NodeJS.Timeout return) doesn't line up with a plain sync stub.
  globalThis.setTimeout = ((fn: () => void) => {
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  return () => {
    globalThis.setTimeout = original;
  };
}
