/**
 * probe-retry.test
 *
 * Tests for classifyProbeFailure and runProbeWithRetry: transient-pattern
 * classification, the single forced live recheck on a permanent verdict
 * (skipped when a recent success is cached), recovery after a transient
 * failure, and consecutive-transient exhaustion becoming permanent.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// NOTE: sleep is mocked to a no-op so tests do not incur real timer delays.
// All exports from agent-retry must be mirrored — bun mock.module is process-global.
const mockSleep = mock((_ms: number) => Promise.resolve());
mock.module('../../agents/abstraction/agent-retry', () => ({
  sleep: mockSleep,
  evaluateRetry: mock(async () => ({ shouldRetry: false, delay: 0 })),
  executeWithRetry: mock(async () => ({})),
  continueWithRetry: mock(async () => ({})),
}));

const { classifyProbeFailure, runProbeWithRetry, PROBE_MAX_RETRIES } =
  await import('./probe-retry');
const { invalidateProbeCache, setCachedProbeResult } = await import('./probe-cache');
import type { ProbeContext, ProbeTarget } from './probe.types';

const CTX: ProbeContext = {
  taskId: 1,
  role: 'researcher',
  agentConfig: { agentType: 'claude-code' },
};

// probe-cache is a module-singleton in-memory Map — reset between tests so
// the forced-live-recheck cache lookup does not leak state across cases.
beforeEach(() => {
  invalidateProbeCache();
});

describe('classifyProbeFailure', () => {
  it.each([
    { name: 'ETIMEDOUT', input: new Error('ETIMEDOUT connect failed') },
    { name: 'ECONNRESET', input: new Error('ECONNRESET connection was reset') },
    { name: 'ECONNREFUSED', input: new Error('ECONNREFUSED') },
    { name: 'network unreachable', input: new Error('network is unreachable') },
    { name: 'timeout text', input: new Error('probe timeout after 3000ms') },
    { name: 'temporarily unavailable', input: new Error('service temporarily unavailable') },
  ])('transient: $name', ({ input }) => {
    expect(classifyProbeFailure(input)).toBe('transient');
  });

  it.each([
    { name: 'auth error', input: new Error('not authenticated') },
    {
      name: 'unknown provider',
      input: new Error('agent endpoint unavailable for provider "gemini"'),
    },
    { name: 'ENOENT', input: new Error('ENOENT: no such file or directory') },
    { name: 'non-Error thrown', input: 'plain string failure' },
  ])('permanent (default fallback): $name', ({ input }) => {
    expect(classifyProbeFailure(input)).toBe('permanent');
  });
});

describe('runProbeWithRetry', () => {
  it('returns success on the first attempt', async () => {
    const target: ProbeTarget = { id: 'db', run: mock(async () => {}) };

    const result = await runProbeWithRetry(target, CTX, 1000);

    expect(result).toMatchObject({ outcome: 'success', attempts: 1, errorMessage: null });
    expect(target.run).toHaveBeenCalledTimes(1);
  });

  it('recovers after a transient failure', async () => {
    let calls = 0;
    const target: ProbeTarget = {
      id: 'db',
      run: mock(async () => {
        calls += 1;
        if (calls === 1) throw new Error('ETIMEDOUT');
      }),
    };

    const result = await runProbeWithRetry(target, CTX, 1000);

    expect(result.outcome).toBe('success');
    expect(result.attempts).toBe(2);
  });

  it('stops immediately on a permanent classification when a recent success is cached', async () => {
    const target: ProbeTarget = {
      id: 'agent-endpoint',
      run: mock(async () => {
        throw new Error('not authenticated');
      }),
    };
    setCachedProbeResult(CTX.taskId, target.id, 'success', 1000);

    const result = await runProbeWithRetry(target, CTX, 1000);

    expect(result).toMatchObject({ outcome: 'permanent_failure', attempts: 1 });
    expect(result.errorMessage).toContain('not authenticated');
    expect(target.run).toHaveBeenCalledTimes(1);
  });

  it('forces one live recheck on a permanent classification with no recent success cached, and recovers', async () => {
    let calls = 0;
    const target: ProbeTarget = {
      id: 'agent-endpoint',
      run: mock(async () => {
        calls += 1;
        if (calls === 1) throw new Error('not authenticated');
      }),
    };

    const result = await runProbeWithRetry(target, CTX, 1000);

    expect(result).toMatchObject({ outcome: 'success', attempts: 2, errorMessage: null });
    expect(target.run).toHaveBeenCalledTimes(2);
  });

  it('forces the recheck with a cache-bypassing attempt index (> 0)', async () => {
    const seenAttempts: number[] = [];
    const target: ProbeTarget = {
      id: 'agent-endpoint',
      run: mock(async (_ctx: ProbeContext, attempt: number) => {
        seenAttempts.push(attempt);
        if (attempt === 0) throw new Error('agent endpoint unavailable for provider "claude"');
      }),
    };

    const result = await runProbeWithRetry(target, CTX, 1000);

    expect(result.outcome).toBe('success');
    expect(seenAttempts).toEqual([0, 1]);
  });

  it('confirms permanent failure when the forced live recheck also fails', async () => {
    const target: ProbeTarget = {
      id: 'agent-endpoint',
      run: mock(async () => {
        throw new Error('not authenticated');
      }),
    };

    const result = await runProbeWithRetry(target, CTX, 1000);

    expect(result).toMatchObject({ outcome: 'permanent_failure', attempts: 2 });
    expect(result.errorMessage).toContain('not authenticated');
    expect(target.run).toHaveBeenCalledTimes(2);
  });

  it('becomes permanent after consecutive transient failures exhaust retries', async () => {
    const target: ProbeTarget = {
      id: 'db',
      run: mock(async () => {
        throw new Error('ECONNRESET');
      }),
    };

    const result = await runProbeWithRetry(target, CTX, 1000);

    expect(result.outcome).toBe('permanent_failure');
    expect(result.attempts).toBe(PROBE_MAX_RETRIES + 1);
  });

  it('honors a per-target timeoutMs override instead of the default PROBE_TIMEOUT_MS', async () => {
    const target: ProbeTarget = {
      id: 'agent-endpoint',
      run: () => new Promise((resolve) => setTimeout(resolve, 40)),
      timeoutMs: 10,
    };

    const result = await runProbeWithRetry(target, CTX, 1000);

    expect(result.outcome).toBe('permanent_failure');
    expect(result.errorMessage).toContain('probe timeout after 10ms');
  });

  it('succeeds when the work fits within a raised per-target timeoutMs', async () => {
    const target: ProbeTarget = {
      id: 'agent-endpoint',
      run: () => new Promise((resolve) => setTimeout(resolve, 40)),
      timeoutMs: 200,
    };

    const result = await runProbeWithRetry(target, CTX, 1000);

    expect(result).toMatchObject({ outcome: 'success', attempts: 1, errorMessage: null });
  });
});
