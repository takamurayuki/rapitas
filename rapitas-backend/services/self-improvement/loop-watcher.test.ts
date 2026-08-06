/**
 * loop-watcher.test
 *
 * Unit tests for the stagnation rules (evaluateRules — pure) and the
 * runLoopReview shell (metrics + concern filing mocked).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { LoopMetricsWindow } from './loop-metrics';

const submitConcernMock = mock(async (_input: unknown): Promise<number> => 1);
mock.module('../memory/concern-backlog-service', () => ({
  submitConcern: submitConcernMock,
}));

const computeLoopMetricsMock = mock(
  async (): Promise<{ windows: LoopMetricsWindow[]; windowDays: number }> => ({
    windows: [],
    windowDays: 7,
  }),
);
mock.module('./loop-metrics', () => ({
  computeLoopMetrics: computeLoopMetricsMock,
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: mock(() => {}), warn: mock(() => {}), debug: mock(() => {}) }),
}));

const { evaluateRules, runLoopReview } = await import('./loop-watcher');

/** Build a window with count overrides. */
function windowWith(over: Partial<LoopMetricsWindow['counts']>): LoopMetricsWindow {
  return {
    from: '2026-07-31T00:00:00.000Z',
    to: '2026-08-07T00:00:00.000Z',
    counts: {
      research_critic_failed: 0,
      research_critic_exhausted: 0,
      plan_critic_failed: 0,
      plan_critic_exhausted: 0,
      verify_repair_total: 0,
      verify_repair_self_contradiction: 0,
      verify_repair_diff_review: 0,
      verify_repair_honest_failure: 0,
      verify_repair_auto_gate: 0,
      verify_repair_other: 0,
      ci_repair: 0,
      completed: 0,
      ...over,
    },
  };
}

beforeEach(() => {
  submitConcernMock.mockClear();
  computeLoopMetricsMock.mockClear();
  submitConcernMock.mockImplementation(async () => 1);
});

describe('evaluateRules', () => {
  it('fires when a signal is loud and not improving', () => {
    const findings = evaluateRules(
      windowWith({ research_critic_failed: 4, completed: 6 }),
      windowWith({ research_critic_failed: 4 }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.key).toBe('research-critic');
    expect(findings[0]!.detail).toContain('= 4 件');
  });

  it('stays silent below the minimum signal even with no improvement', () => {
    const findings = evaluateRules(
      windowWith({ research_critic_failed: 2 }),
      windowWith({ research_critic_failed: 2 }),
    );
    expect(findings).toHaveLength(0);
  });

  it('stays silent when the bucket is improving (current < previous)', () => {
    const findings = evaluateRules(
      windowWith({ verify_repair_diff_review: 4 }),
      windowWith({ verify_repair_diff_review: 7 }),
    );
    expect(findings).toHaveLength(0);
  });

  it('fires independently per bucket', () => {
    const findings = evaluateRules(
      windowWith({ ci_repair: 5, verify_repair_self_contradiction: 3 }),
      windowWith({ ci_repair: 4, verify_repair_self_contradiction: 2 }),
    );
    expect(findings.map((f) => f.key).sort()).toEqual(['ci-repair', 'verify-self-contradiction']);
  });
});

describe('runLoopReview', () => {
  it('files a dedup-keyed concern per firing rule', async () => {
    computeLoopMetricsMock.mockImplementation(async () => ({
      windows: [windowWith({ ci_repair: 5 }), windowWith({ ci_repair: 5 })],
      windowDays: 7,
    }));
    const filed = await runLoopReview();
    expect(filed).toBe(1);
    expect(submitConcernMock).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'loop-review:ci-repair', source: 'loop_review' }),
    );
  });

  it('returns 0 with fewer than two windows', async () => {
    computeLoopMetricsMock.mockImplementation(async () => ({
      windows: [windowWith({})],
      windowDays: 7,
    }));
    expect(await runLoopReview()).toBe(0);
    expect(submitConcernMock).not.toHaveBeenCalled();
  });

  it('keeps filing the remaining concerns when one submission throws', async () => {
    computeLoopMetricsMock.mockImplementation(async () => ({
      windows: [
        windowWith({ ci_repair: 5, research_critic_failed: 4 }),
        windowWith({ ci_repair: 5, research_critic_failed: 4 }),
      ],
      windowDays: 7,
    }));
    submitConcernMock.mockImplementationOnce(async () => {
      throw new Error('db down');
    });
    const filed = await runLoopReview();
    expect(filed).toBe(1); // one failed, one filed
  });
});
