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
    fromStatus: null,
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

  it('excludes state-invariant completed→completed rows from counts.completed', () => {
    const rows = [
      row(1, { toStatus: 'completed', fromStatus: 'completed' }),
      row(1, { toStatus: 'completed', fromStatus: 'in_progress' }),
    ];
    const w = bucketTransitions(rows, NOW, 7, 1);
    expect(w[0]!.counts.completed).toBe(1);
  });
});

describe('bucketTransitions diff-review sub-classification', () => {
  const row = (reason: string): TransitionRowLite => ({
    cause: 'verify_repair',
    toStatus: 'in_progress',
    fromStatus: 'verify_done',
    metadata: JSON.stringify({ reason }),
    createdAt: new Date(NOW.getTime() - 60_000),
  });

  it('splits diff_review into scope_drift / plan_gap / unclassified that sum to the total', () => {
    const w = bucketTransitions(
      [
        row('差分レビュー不合格: 計画外のファイルが混入'),
        row('差分レビュー不合格: 受入基準のテストが未実装'),
        row('差分レビュー不合格: 受入基準のテストが未実装'),
        row('差分レビュー不合格: 命名が不統一'),
        row('自動検証に失敗しました（lint=NG）'),
      ],
      NOW,
      7,
      1,
    );
    const c = w[0]!.counts;
    expect(c.verify_repair_diff_review).toBe(4);
    expect(c.verify_repair_diff_review_scope_drift).toBe(1);
    expect(c.verify_repair_diff_review_plan_gap).toBe(2);
    expect(c.verify_repair_diff_review_unclassified).toBe(1);
    expect(
      c.verify_repair_diff_review_scope_drift +
        c.verify_repair_diff_review_plan_gap +
        c.verify_repair_diff_review_unclassified,
    ).toBe(c.verify_repair_diff_review);
  });
});

describe('bucketTransitions bounce breakdown', () => {
  const meta = (reason: string) => JSON.stringify({ reason });

  it('adds per-kind counts (incl. other) and top tasks to each window', () => {
    const rows = [
      row(1, { cause: 'verify_repair', taskId: 10, metadata: meta('差分レビュー不合格: x') }),
      row(1, { cause: 'verify_repair', taskId: 10, metadata: meta('ERR_PNPM_FETCH_404') }),
      row(2, { cause: 'verify_repair', taskId: 11, metadata: meta('verify.md self-contradicts') }),
      row(2, {
        cause: 'ci_repair',
        taskId: 11,
        metadata: JSON.stringify({ failedChecks: ['lint'] }),
      }),
      row(2, { cause: 'verify_repair', taskId: 12, metadata: 'not json' }),
    ];
    const w = bucketTransitions(rows, NOW, 7, 1)[0]!;
    expect(w.bounceKinds).toEqual({
      verify_contradiction: 1,
      diff_review: 1,
      environment: 1,
      plan_gap: 0,
      implementation_gap: 0,
      other: 2,
    });
    expect(w.topBounceTasks).toEqual([
      { taskId: 10, count: 2 },
      { taskId: 11, count: 2 },
      { taskId: 12, count: 1 },
    ]);
    // Existing counters are untouched.
    expect(w.counts.verify_repair_total).toBe(4);
    expect(w.counts.ci_repair).toBe(1);
  });

  it('returns zeroed kinds and no tasks for an empty window', () => {
    const w = bucketTransitions([], NOW, 7, 1)[0]!;
    expect(Object.values(w.bounceKinds!).every((n) => n === 0)).toBe(true);
    expect(w.topBounceTasks).toEqual([]);
    expect(w.contradictionPatterns).toEqual([]);
  });

  it('本文の分類優先順と候補を現在窓だけに反映する', () => {
    const rows = [
      row(1, {
        cause: 'verify_repair',
        taskId: 1,
        metadata: JSON.stringify({
          reason: '自動検証に失敗しました（test=NG）',
          verifyContent: 'ERR_PNPM_FETCH_404',
        }),
      }),
      ...[1, 2, 3, 8].map((daysAgo) =>
        row(daysAgo, {
          cause: 'verify_repair',
          metadata: JSON.stringify({ verifyContent: `self-contradicts run ${daysAgo}` }),
        }),
      ),
      row(1, { cause: 'ci_repair', metadata: JSON.stringify({ failedChecks: ['EADDRINUSE'] }) }),
    ];
    const [current, previous] = bucketTransitions(rows, NOW, 7, 2);
    expect(current!.bounceKinds!.environment).toBe(2);
    expect(current!.contradictionPatterns).toEqual([
      expect.objectContaining({ count: 3, sample: expect.stringContaining('self-contradicts') }),
    ]);
    expect(previous!.contradictionPatterns).toEqual([expect.objectContaining({ count: 1 })]);
    expect(current!.topBounceTasks).toEqual([{ taskId: 1, count: 1 }]);
    expect(current!.counts.verify_repair_auto_gate).toBe(1);
  });
});
