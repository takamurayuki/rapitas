/**
 * agent-lifecycle-handlers.test-support
 *
 * Shared fixtures for the runExecute/runContinue test suites: context/task/
 * result builders, a fake ExecutionCallbacks, and a transition-call spy.
 */
import type { ExecutionCallbacks } from './agent-lifecycle-handlers';
import type {
  AgentState,
  AgentMetadata,
  AgentExecutionContext,
  AgentTaskDefinition,
  AgentExecutionResult,
  AgentLifecycleHooks,
  ExecutionMetrics,
  DebugLogEntry,
} from './types';

export const noHooks: AgentLifecycleHooks = {};
export const noLog = (): void => {};

export function makeContext(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return {
    executionId: 'exec-1',
    workingDirectory: '/tmp/work',
    ...overrides,
  };
}

export function makeTask(overrides: Partial<AgentTaskDefinition> = {}): AgentTaskDefinition {
  return { id: 1, title: 'task', ...overrides };
}

export function makeResult(overrides: Partial<AgentExecutionResult> = {}): AgentExecutionResult {
  return { success: true, state: 'completed', output: 'ok', ...overrides };
}

/** Fake ExecutionCallbacks backed by plain closures so tests can inspect what was stored. */
export function makeCallbacks(state: AgentState = 'idle'): ExecutionCallbacks & {
  getContextCalls: (AgentExecutionContext | null)[];
} {
  const metadata: AgentMetadata = {
    id: 'agent-1',
    providerId: 'custom',
    name: 'agent',
    createdAt: new Date(),
  };
  let metrics: ExecutionMetrics | null = null;
  let debugLogs: DebugLogEntry[] = [];
  const contextCalls: (AgentExecutionContext | null)[] = [];

  return {
    getState: () => state,
    getIsDisposed: () => false,
    getMetadata: () => metadata,
    setCurrentContext: (ctx) => {
      contextCalls.push(ctx);
    },
    setMetrics: (m) => {
      metrics = m;
    },
    setDebugLogs: (logs) => {
      debugLogs = logs;
    },
    getMetrics: () => metrics,
    getDebugLogs: () => debugLogs,
    getContextCalls: contextCalls,
  };
}

export function makeTransitionSpy(): {
  fn: (state: string, reason?: string) => Promise<void>;
  calls: Array<[string, string | undefined]>;
} {
  const calls: Array<[string, string | undefined]> = [];
  return {
    calls,
    fn: async (state, reason) => {
      calls.push([state, reason]);
    },
  };
}
