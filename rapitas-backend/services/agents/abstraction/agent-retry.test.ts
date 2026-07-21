/**
 * agent-retry.test
 *
 * Unit tests for evaluateRetry() covering env-var control, context.maxRetries,
 * policy argument priority, and the upperBound hard cap.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { evaluateRetry, sleep, executeWithRetry, continueWithRetry } from './agent-retry';
import { AgentError } from './interfaces';
import type {
  AgentExecutionContext,
  AgentExecutionResult,
  AgentTaskDefinition,
  ContinuationContext,
} from './types';
import type { AgentLifecycleHooks } from './types';
import type { RetryPolicy } from './retry-policy';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return {
    executionId: 'test-exec',
    workingDirectory: '/tmp',
    ...overrides,
  };
}

function makeError(recoverable = true): AgentError {
  return new AgentError('test error', 'network', recoverable);
}

const noHooks: AgentLifecycleHooks = {};
const noLog = () => {};

// ──────────────────────────────────────────────────────────────────────────────
// env var helpers
// ──────────────────────────────────────────────────────────────────────────────

const retryEnvKeys = ['RAPITAS_RETRY_MAX', 'RAPITAS_RETRY_DELAY_MS', 'RAPITAS_RETRY_UPPER_BOUND'];
const saved: Record<string, string | undefined> = {};

function saveEnv(): void {
  for (const k of retryEnvKeys) saved[k] = process.env[k];
}
function restoreEnv(): void {
  for (const k of retryEnvKeys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('evaluateRetry — env var unset (defaults)', () => {
  afterEach(restoreEnv);

  it('allows up to 3 retries by default (retryCount < 3)', async () => {
    saveEnv();
    delete process.env['RAPITAS_RETRY_MAX'];
    delete process.env['RAPITAS_RETRY_DELAY_MS'];
    delete process.env['RAPITAS_RETRY_UPPER_BOUND'];

    const result = await evaluateRetry(makeError(), makeCtx(), 2, noHooks, noLog);
    expect(result.shouldRetry).toBe(true);
  });

  it('stops at retryCount === 3 (default maxRetries)', async () => {
    saveEnv();
    delete process.env['RAPITAS_RETRY_MAX'];

    const result = await evaluateRetry(makeError(), makeCtx(), 3, noHooks, noLog);
    expect(result.shouldRetry).toBe(false);
  });

  it('uses 3000 ms delay by default', async () => {
    saveEnv();
    delete process.env['RAPITAS_RETRY_MAX'];
    delete process.env['RAPITAS_RETRY_DELAY_MS'];

    const result = await evaluateRetry(makeError(), makeCtx(), 0, noHooks, noLog);
    expect(result.delay).toBe(3000);
  });
});

describe('evaluateRetry — RAPITAS_RETRY_MAX', () => {
  afterEach(restoreEnv);

  it('respects RAPITAS_RETRY_MAX=5', async () => {
    saveEnv();
    process.env['RAPITAS_RETRY_MAX'] = '5';

    const at4 = await evaluateRetry(makeError(), makeCtx(), 4, noHooks, noLog);
    expect(at4.shouldRetry).toBe(true);

    const at5 = await evaluateRetry(makeError(), makeCtx(), 5, noHooks, noLog);
    expect(at5.shouldRetry).toBe(false);
  });
});

describe('evaluateRetry — RAPITAS_RETRY_DELAY_MS', () => {
  afterEach(restoreEnv);

  it('uses delay from RAPITAS_RETRY_DELAY_MS=1000', async () => {
    saveEnv();
    process.env['RAPITAS_RETRY_DELAY_MS'] = '1000';

    const result = await evaluateRetry(makeError(), makeCtx(), 0, noHooks, noLog);
    expect(result.delay).toBe(1000);
  });
});

describe('evaluateRetry — context.maxRetries', () => {
  afterEach(restoreEnv);

  it('uses context.maxRetries=2 over env default', async () => {
    saveEnv();
    delete process.env['RAPITAS_RETRY_MAX'];

    const at1 = await evaluateRetry(makeError(), makeCtx({ maxRetries: 2 }), 1, noHooks, noLog);
    expect(at1.shouldRetry).toBe(true);

    const at2 = await evaluateRetry(makeError(), makeCtx({ maxRetries: 2 }), 2, noHooks, noLog);
    expect(at2.shouldRetry).toBe(false);
  });
});

describe('evaluateRetry — policy argument priority', () => {
  afterEach(restoreEnv);

  it('policy argument takes precedence over context.maxRetries', async () => {
    saveEnv();
    delete process.env['RAPITAS_RETRY_MAX'];

    const policy: RetryPolicy = { maxRetries: 1, delayMs: 500, upperBound: 10 };
    const ctx = makeCtx({ maxRetries: 5 });

    const at1 = await evaluateRetry(makeError(), ctx, 1, noHooks, noLog, policy);
    expect(at1.shouldRetry).toBe(false);
  });

  it('policy.delayMs is used as the delay', async () => {
    saveEnv();
    const policy: RetryPolicy = { maxRetries: 3, delayMs: 999, upperBound: 10 };

    const result = await evaluateRetry(makeError(), makeCtx(), 0, noHooks, noLog, policy);
    expect(result.delay).toBe(999);
  });
});

describe('evaluateRetry — upperBound hard cap', () => {
  afterEach(restoreEnv);

  it('blocks retry at upperBound regardless of maxRetries', async () => {
    saveEnv();
    process.env['RAPITAS_RETRY_MAX'] = '20';
    process.env['RAPITAS_RETRY_UPPER_BOUND'] = '5';

    const result = await evaluateRetry(makeError(), makeCtx(), 5, noHooks, noLog);
    expect(result.shouldRetry).toBe(false);
  });
});

describe('evaluateRetry — non-recoverable error', () => {
  afterEach(restoreEnv);

  it('does not retry non-recoverable errors', async () => {
    saveEnv();
    const result = await evaluateRetry(makeError(false), makeCtx(), 0, noHooks, noLog);
    expect(result.shouldRetry).toBe(false);
  });
});

describe('evaluateRetry — onError hook takes precedence', () => {
  it('defers to hook result when hook is present', async () => {
    const hooks: AgentLifecycleHooks = {
      onError: async () => ({ retry: true, delay: 1234 }),
    };

    // Even with a non-recoverable error, the hook says retry
    const result = await evaluateRetry(makeError(false), makeCtx(), 0, hooks, noLog);
    expect(result.shouldRetry).toBe(true);
    expect(result.delay).toBe(1234);
  });

  it('returns shouldRetry=false when hook throws', async () => {
    const hooks: AgentLifecycleHooks = {
      onError: async () => {
        throw new Error('hook failure');
      },
    };
    const result = await evaluateRetry(makeError(), makeCtx(), 0, hooks, noLog);
    expect(result.shouldRetry).toBe(false);
  });
});

describe('sleep', () => {
  it('resolves after roughly the given delay', async () => {
    const start = performance.now();
    await sleep(10);
    expect(performance.now() - start).toBeGreaterThanOrEqual(5);
  });

  it('resolves immediately for a 0ms delay', async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });
});

describe('executeWithRetry', () => {
  afterEach(restoreEnv);

  const transitionFn = async () => {};
  const isDisposedFn = () => false;
  const getStateFn = () => 'running';

  it('returns the result immediately on success (no retry needed)', async () => {
    const doExecute = async () => ({ success: true }) as unknown as AgentExecutionResult;
    const result = await executeWithRetry(
      doExecute,
      {} as AgentTaskDefinition,
      makeCtx(),
      noHooks,
      transitionFn,
      isDisposedFn,
      getStateFn,
      noLog,
    );
    expect(result).toEqual({ success: true });
  });

  it('retries a recoverable AgentError and eventually succeeds', async () => {
    saveEnv();
    process.env['RAPITAS_RETRY_DELAY_MS'] = '1';
    let attempts = 0;
    const doExecute = async () => {
      attempts++;
      if (attempts < 2) throw new AgentError('transient', 'network', true);
      return { success: true } as unknown as AgentExecutionResult;
    };
    const result = await executeWithRetry(
      doExecute,
      {} as AgentTaskDefinition,
      makeCtx(),
      noHooks,
      transitionFn,
      isDisposedFn,
      getStateFn,
      noLog,
    );
    expect(result).toEqual({ success: true });
    expect(attempts).toBe(2);
  });

  it('throws the AgentError immediately for a non-recoverable error (no retry)', async () => {
    const doExecute = async (): Promise<AgentExecutionResult> => {
      throw new AgentError('fatal', 'internal', false);
    };
    await expect(
      executeWithRetry(
        doExecute,
        {} as AgentTaskDefinition,
        makeCtx(),
        noHooks,
        transitionFn,
        isDisposedFn,
        getStateFn,
        noLog,
      ),
    ).rejects.toThrow('fatal');
  });

  it('wraps a plain (non-AgentError) thrown error before evaluating retry', async () => {
    const doExecute = async (): Promise<AgentExecutionResult> => {
      throw new Error('plain error');
    };
    await expect(
      executeWithRetry(
        doExecute,
        {} as AgentTaskDefinition,
        makeCtx(),
        noHooks,
        transitionFn,
        isDisposedFn,
        getStateFn,
        noLog,
      ),
    ).rejects.toThrow('plain error');
  });

  it('stops retrying and throws when the agent becomes disposed during the delay', async () => {
    saveEnv();
    process.env['RAPITAS_RETRY_DELAY_MS'] = '1';
    const doExecute = async (): Promise<AgentExecutionResult> => {
      throw new AgentError('transient', 'network', true);
    };
    await expect(
      executeWithRetry(
        doExecute,
        {} as AgentTaskDefinition,
        makeCtx(),
        noHooks,
        transitionFn,
        () => true, // isDisposedFn -> disposed
        getStateFn,
        noLog,
      ),
    ).rejects.toThrow('Agent was disposed or cancelled during retry delay');
  });
});

describe('continueWithRetry', () => {
  afterEach(restoreEnv);

  const transitionFn = async () => {};
  const isDisposedFn = () => false;
  const getStateFn = () => 'running';

  it('returns the result immediately on success (no retry needed)', async () => {
    const doContinue = async () => ({ success: true }) as unknown as AgentExecutionResult;
    const result = await continueWithRetry(
      doContinue,
      {} as ContinuationContext,
      makeCtx(),
      noHooks,
      transitionFn,
      isDisposedFn,
      getStateFn,
      noLog,
    );
    expect(result).toEqual({ success: true });
  });

  it('retries a recoverable AgentError and eventually succeeds', async () => {
    saveEnv();
    process.env['RAPITAS_RETRY_DELAY_MS'] = '1';
    let attempts = 0;
    const doContinue = async () => {
      attempts++;
      if (attempts < 2) throw new AgentError('transient', 'network', true);
      return { success: true } as unknown as AgentExecutionResult;
    };
    const result = await continueWithRetry(
      doContinue,
      {} as ContinuationContext,
      makeCtx(),
      noHooks,
      transitionFn,
      isDisposedFn,
      getStateFn,
      noLog,
    );
    expect(result).toEqual({ success: true });
    expect(attempts).toBe(2);
  });

  it('throws immediately for a non-recoverable error', async () => {
    const doContinue = async (): Promise<AgentExecutionResult> => {
      throw new AgentError('fatal', 'internal', false);
    };
    await expect(
      continueWithRetry(
        doContinue,
        {} as ContinuationContext,
        makeCtx(),
        noHooks,
        transitionFn,
        isDisposedFn,
        getStateFn,
        noLog,
      ),
    ).rejects.toThrow('fatal');
  });

  it('stops retrying and throws when the state becomes cancelled during the delay', async () => {
    saveEnv();
    process.env['RAPITAS_RETRY_DELAY_MS'] = '1';
    const doContinue = async (): Promise<AgentExecutionResult> => {
      throw new AgentError('transient', 'network', true);
    };
    await expect(
      continueWithRetry(
        doContinue,
        {} as ContinuationContext,
        makeCtx(),
        noHooks,
        transitionFn,
        isDisposedFn,
        () => 'cancelled',
        noLog,
      ),
    ).rejects.toThrow('Agent was disposed or cancelled during retry delay');
  });
});
