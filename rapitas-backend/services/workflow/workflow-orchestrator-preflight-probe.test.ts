/**
 * workflow-orchestrator-preflight-probe.test
 *
 * Tests for runPreflightProbe: success continues, a cache hit skips
 * re-probing, and a permanent failure blocks the transition and fires the
 * alert exactly once (per plan.md's Definition of Done).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  logger: noopLogger,
  createLogger: () => noopLogger,
}));

const mockAlert = mock(async (..._args: unknown[]) => {});
mock.module('./probe/probe-alert', () => ({ alertPermanentProbeFailure: mockAlert }));

const cacheStore = new Map<string, string>();
const mockGetCached = mock((taskId: number, targetId: string, _nowMs: number) => {
  return (cacheStore.get(`${taskId}:${targetId}`) as never) ?? null;
});
const mockSetCached = mock((taskId: number, targetId: string, outcome: string, _nowMs: number) => {
  cacheStore.set(`${taskId}:${targetId}`, outcome as never);
});
mock.module('./probe/probe-cache', () => ({
  getCachedProbeResult: mockGetCached,
  setCachedProbeResult: mockSetCached,
}));

const mockRunProbeWithRetry = mock(
  async (_target: { id: string }, _ctx: unknown, _nowMs: number) => ({
    outcome: 'success' as const,
    attempts: 1,
    latencyMs: 5,
    errorMessage: null as string | null,
  }),
);
mock.module('./probe/probe-retry', () => ({ runProbeWithRetry: mockRunProbeWithRetry }));

mock.module('./probe/probe-targets', () => ({
  PROBE_TARGETS: [
    { id: 'db', run: mock(async () => {}) },
    { id: 'agent-endpoint', run: mock(async () => {}) },
  ],
}));

const mockRecordProbeAttempt = mock((_record: unknown) => {});
mock.module('../ai/probe-metrics', () => ({ recordProbeAttempt: mockRecordProbeAttempt }));

const { runPreflightProbe } = await import('./workflow-orchestrator-preflight-probe');

const AGENT_CONFIG = { agentType: 'claude-code' };

describe('runPreflightProbe', () => {
  beforeEach(() => {
    cacheStore.clear();
    mockAlert.mockClear();
    mockGetCached.mockClear();
    mockSetCached.mockClear();
    mockRecordProbeAttempt.mockClear();
    mockRunProbeWithRetry.mockClear();
    mockRunProbeWithRetry.mockImplementation(async () => ({
      outcome: 'success',
      attempts: 1,
      latencyMs: 5,
      errorMessage: null,
    }));
  });

  it('continues (done:false) when every target succeeds', async () => {
    const result = await runPreflightProbe(1, 'researcher', AGENT_CONFIG, 'draft');

    expect(result).toEqual({ done: false });
    expect(mockRunProbeWithRetry).toHaveBeenCalledTimes(2);
    expect(mockRecordProbeAttempt).toHaveBeenCalledTimes(2);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('skips re-probing (and metrics) for a cached target', async () => {
    cacheStore.set('1:db', 'success');
    cacheStore.set('1:agent-endpoint', 'success');

    const result = await runPreflightProbe(1, 'researcher', AGENT_CONFIG, 'draft');

    expect(result).toEqual({ done: false });
    expect(mockRunProbeWithRetry).not.toHaveBeenCalled();
    expect(mockRecordProbeAttempt).not.toHaveBeenCalled();
  });

  it('blocks the transition and alerts once on a permanent failure', async () => {
    mockRunProbeWithRetry.mockImplementation(async (target: { id: string }) => {
      if (target.id === 'agent-endpoint') {
        return {
          outcome: 'permanent_failure',
          attempts: 3,
          latencyMs: 40,
          errorMessage: 'auth failed',
        };
      }
      return { outcome: 'success', attempts: 1, latencyMs: 5, errorMessage: null };
    });

    const result = await runPreflightProbe(1, 'researcher', AGENT_CONFIG, 'draft');

    expect(result.done).toBe(true);
    if (result.done) {
      expect(result.result.success).toBe(false);
      expect(result.result.status).toBe('draft');
      expect(result.result.error).toContain('agent-endpoint');
    }
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert).toHaveBeenCalledWith(1, 'agent-endpoint', 'researcher', 'auth failed');
  });
});
