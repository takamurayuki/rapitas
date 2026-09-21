/**
 * pr-risk-review-job test
 *
 * Pins the monthly loop: label collection, one idempotent metric row per
 * previous month (only once the month has settled 72h), retraining gated on
 * label counts, and a threshold-review audit row every month with auto-only
 * adoption and precision-based demotion.
 */
import { describe, it, expect } from 'bun:test';
import { runPrRiskReviewJob, type ReviewJobDeps } from './pr-risk-review-job';
import { createFakeDb } from './pr-risk-fake-db.test-helpers';
import { createScore, readConfig, upsertOutcome, writeConfig } from './pr-risk-store';
import type { PrRiskStage } from './pr-risk-types';
import { BACKLOG_JOB_KINDS, DEFAULTS } from '../../scheduling/backlog-schedule-service';

const NOW = new Date('2026-09-10T00:00:00Z'); // previous month = 2026-08
const noopLog = { warn: () => {}, info: () => {} };

const feat = (dep: number) => ({
  file_size: dep ? 8 : 3,
  files_changed: 2,
  author: 0,
  dependency_change: dep,
  schema_change: 0,
});

/** Seed n settled PRs merged in August: every 4th is a failure with a high score. */
async function seed(db: ReturnType<typeof createFakeDb>['db'], n: number, thresholdUsed = 0.5) {
  for (let i = 1; i <= n; i++) {
    const fail = i % 4 === 0;
    await createScore(db, {
      repo: 'o/r',
      prNumber: i,
      headSha: `h${i}`,
      taskId: i,
      score: fail ? 0.8 : 0.2,
      baseLogit: -2.2,
      featuresJson: JSON.stringify(feat(fail ? 1 : 0)),
      contributionsJson: '[]',
      thresholdUsed,
      stage: 'display',
      modelVersion: 0,
      held: false,
      commentPostedAt: null,
    });
    await upsertOutcome(
      db,
      {
        repo: 'o/r',
        prNumber: i,
        mergeSha: `m${i}`,
        mergedAt: new Date(Date.UTC(2026, 7, 1 + (i % 28))),
        label: fail ? 'failure' : 'success',
        failureKind: fail ? 'rollback_72h' : null,
        revertSha: null,
        revertAt: null,
      },
      NOW,
    );
  }
}

async function setup(stage: PrRiskStage, n: number, threshold = 0.5) {
  const f = createFakeDb();
  await writeConfig(f.db, { stage, threshold });
  await seed(f.db, n);
  const deps: ReviewJobDeps = {
    db: f.db,
    now: () => NOW,
    log: noopLog,
    viewPr: async () => {
      throw new Error('no pending PRs expected');
    },
    gitLog: async () => '',
  };
  return { ...f, deps };
}

describe('runPrRiskReviewJob — monthly metrics', () => {
  it('records one metric row for the previous month and is idempotent', async () => {
    const s = await setup('display', 20);
    await runPrRiskReviewJob(s.deps);
    await runPrRiskReviewJob(s.deps);
    expect(s.tables.prRiskMonthlyMetric.rows).toHaveLength(1);
    expect(s.tables.prRiskMonthlyMetric.rows[0]).toMatchObject({
      month: '2026-08',
      sample: 20,
      tp: 5,
      fp: 0,
      fn: 0,
      tn: 15,
      precision: 1,
      recall: 1,
      fpr: 0,
    });
    // Review is monthly too: one audit row despite two runs.
    expect(s.tables.prRiskThresholdReview.rows).toHaveLength(1);
  });

  it('records sample=0 with null ratios when the month had no data', async () => {
    const s = await setup('display', 0);
    await runPrRiskReviewJob(s.deps);
    expect(s.tables.prRiskMonthlyMetric.rows[0]).toMatchObject({
      month: '2026-08',
      sample: 0,
      precision: null,
      recall: null,
      fpr: null,
    });
  });

  it('waits until 72h into the month before recording', async () => {
    const s = await setup('display', 20);
    s.deps.now = () => new Date('2026-09-02T00:00:00Z');
    await runPrRiskReviewJob(s.deps);
    expect(s.tables.prRiskMonthlyMetric.rows).toHaveLength(0);
  });
});

describe('runPrRiskReviewJob — retraining', () => {
  it('does not train below 30 settled labels', async () => {
    const s = await setup('display', 20);
    await runPrRiskReviewJob(s.deps);
    expect((await readConfig(s.db)).modelVersion).toBe(0);
  });

  it('trains and bumps modelVersion with ≥ 30 labels and ≥ 5 failures', async () => {
    const s = await setup('display', 32);
    await runPrRiskReviewJob(s.deps);
    const cfg = await readConfig(s.db);
    expect(cfg.modelVersion).toBe(1);
    expect(JSON.parse(cfg.modelJson as string).weights.dependency_change).toBeGreaterThan(0);
  });
});

describe('runPrRiskReviewJob — threshold review', () => {
  it('display/hold: records the proposal without adopting it', async () => {
    for (const stage of ['display', 'hold'] as const) {
      const s = await setup(stage, 32);
      await runPrRiskReviewJob(s.deps);
      const review = s.tables.prRiskThresholdReview.rows[0];
      expect(review).toMatchObject({ month: '2026-08', previousThreshold: 0.5, adopted: false });
      expect(review.proposedThreshold).toBeCloseTo(0.8, 12);
      expect((await readConfig(s.db)).threshold).toBe(0.5);
    }
  });

  it('auto with a trained model: adopts the proposal', async () => {
    const s = await setup('auto', 32);
    await writeConfig(s.db, { modelVersion: 1 });
    await runPrRiskReviewJob(s.deps);
    expect(s.tables.prRiskThresholdReview.rows[0]).toMatchObject({ adopted: true });
    expect((await readConfig(s.db)).threshold).toBeCloseTo(0.8, 12);
  });

  it('insufficient labels: records a null proposal with the reason', async () => {
    const s = await setup('auto', 10);
    await runPrRiskReviewJob(s.deps);
    expect(s.tables.prRiskThresholdReview.rows[0]).toMatchObject({
      proposedThreshold: null,
      adopted: false,
      reason: 'insufficient_labels',
    });
  });

  it('auto with precision < 0.3: demotes to hold', async () => {
    // threshold 0.1 at scoring time → every success is a false positive
    const f = createFakeDb();
    await writeConfig(f.db, { stage: 'auto', modelVersion: 1 });
    await seed(f.db, 24, 0.1);
    await runPrRiskReviewJob({
      db: f.db,
      now: () => NOW,
      log: noopLog,
      viewPr: async () => ({
        title: '',
        mergedAt: null,
        mergeSha: null,
        baseBranch: 'x',
        commitShas: [],
      }),
      gitLog: async () => '',
    });
    expect((await readConfig(f.db)).stage).toBe('hold');
    expect(f.tables.prRiskThresholdReview.rows[0]).toMatchObject({
      adopted: false,
      reason: 'demoted_low_precision',
    });
  });
});

describe('runPrRiskReviewJob — label collection', () => {
  it('labels a pending PR reverted within 72h as failure via viewPr + gitLog', async () => {
    const f = createFakeDb();
    await upsertOutcome(
      f.db,
      {
        repo: 'o/r',
        prNumber: 99,
        mergeSha: null,
        mergedAt: null,
        label: 'pending',
        failureKind: null,
        revertSha: null,
        revertAt: null,
      },
      NOW,
    );
    const merged = new Date('2026-09-01T00:00:00Z');
    const n = await runPrRiskReviewJob({
      db: f.db,
      now: () => NOW,
      log: noopLog,
      viewPr: async () => ({
        title: 'feat: z',
        mergedAt: merged.toISOString(),
        mergeSha: 'mm',
        baseBranch: 'develop',
        commitShas: [],
      }),
      gitLog: async () =>
        `rv\x1f${new Date(merged.getTime() + 3600_000).toISOString()}\x1fRevert "feat: z"\n\x1e`,
    });
    expect(f.tables.prOutcome.rows[0]).toMatchObject({
      label: 'failure',
      failureKind: 'rollback_72h',
    });
    expect(n).toBeGreaterThanOrEqual(1);
  });
});

describe('scheduling', () => {
  it('registers pr_risk_review as a weekly job (idempotent ⇒ monthly records)', () => {
    expect(BACKLOG_JOB_KINDS).toContain('pr_risk_review');
    expect(DEFAULTS.pr_risk_review).toEqual({
      enabled: true,
      frequency: 'weekly',
      hour: 6,
      weekday: 3,
    });
  });
});
