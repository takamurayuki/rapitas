/**
 * loop-metrics.test
 *
 * Unit tests for the pure metric core: repair-reason classification and
 * window bucketing. computeLoopMetrics (prisma query) is a thin shell over
 * these and is not exercised here.
 */
import { describe, it, expect } from 'bun:test';
import { classifyRepairReason, bucketTransitions, type TransitionRowLite } from './loop-metrics';

describe('classifyRepairReason', () => {
  it('maps each known reason family to its bucket', () => {
    expect(classifyRepairReason('差分レビュー不合格: スコープ逸脱')).toBe('diff_review');
    expect(classifyRepairReason('verify.md self-contradicts: claims pass')).toBe(
      'self_contradiction',
    );
    expect(classifyRepairReason('verify.md explicitly marks the verification as failed.')).toBe(
      'honest_failure',
    );
    expect(classifyRepairReason('自動検証に失敗しました（lint=NG）')).toBe('auto_gate');
  });

  it('falls back to other for unknown or missing reasons', () => {
    expect(classifyRepairReason('something new')).toBe('other');
    expect(classifyRepairReason(undefined)).toBe('other');
    expect(classifyRepairReason(null)).toBe('other');
  });
});

const NOW = new Date('2026-08-07T00:00:00Z');

/** Shorthand transition row `daysAgo` days before NOW. */
function row(daysAgo: number, over: Partial<TransitionRowLite>): TransitionRowLite {
  return {
    cause: null,
    toStatus: null,
    metadata: null,
    createdAt: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000),
    ...over,
  };
}

describe('bucketTransitions', () => {
  it('assigns rows to the correct window, newest first', () => {
    const rows = [
      row(1, { cause: 'research_critic_failed' }),
      row(8, { cause: 'research_critic_failed' }),
      row(8.5, { cause: 'ci_repair' }),
      row(15, { toStatus: 'completed' }),
    ];
    const w = bucketTransitions(rows, NOW, 7, 3);
    expect(w).toHaveLength(3);
    expect(w[0]!.counts.research_critic_failed).toBe(1);
    expect(w[1]!.counts.research_critic_failed).toBe(1);
    expect(w[1]!.counts.ci_repair).toBe(1);
    expect(w[2]!.counts.completed).toBe(1);
  });

  it('classifies verify_repair rows by their metadata reason', () => {
    const rows = [
      row(1, {
        cause: 'verify_repair',
        metadata: JSON.stringify({ reason: 'verify.md self-contradicts: x' }),
      }),
      row(2, {
        cause: 'verify_repair',
        metadata: JSON.stringify({ reason: '差分レビュー不合格: y' }),
      }),
      row(3, { cause: 'verify_repair', metadata: 'not json' }),
    ];
    const w = bucketTransitions(rows, NOW, 7, 1);
    expect(w[0]!.counts.verify_repair_total).toBe(3);
    expect(w[0]!.counts.verify_repair_self_contradiction).toBe(1);
    expect(w[0]!.counts.verify_repair_diff_review).toBe(1);
    expect(w[0]!.counts.verify_repair_other).toBe(1);
  });

  it('ignores rows outside the covered range (too old or in the future)', () => {
    const rows = [
      row(100, { cause: 'ci_repair' }),
      row(-1, { cause: 'ci_repair' }), // future
    ];
    const w = bucketTransitions(rows, NOW, 7, 2);
    expect(w[0]!.counts.ci_repair).toBe(0);
    expect(w[1]!.counts.ci_repair).toBe(0);
  });

  it('counts a completed transition that also carries a bounce cause once each', () => {
    const rows = [row(1, { cause: 'ci_repair', toStatus: 'completed' })];
    const w = bucketTransitions(rows, NOW, 7, 1);
    expect(w[0]!.counts.ci_repair).toBe(1);
    expect(w[0]!.counts.completed).toBe(1);
  });
});
