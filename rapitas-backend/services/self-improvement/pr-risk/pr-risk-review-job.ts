/**
 * pr-risk-review-job
 *
 * The scheduled monitoring loop for PR-risk prediction: settle outcome labels,
 * record the previous month's precision/recall/FPR (once, after the month has
 * settled 72h), retrain when enough labels exist, and review the threshold
 * (audit row every month; auto-adopt only in stage `auto`; demote `auto` →
 * `hold` on low precision). Stages are independent and fail-open. Returns the
 * produced row count as the backlog-scheduler HANDLERS contract requires.
 */
import { createLogger } from '../../../config/logger';
import { runGhCommand } from '../../github/gh-client';
import { collectOutcomes, type OutcomeDeps } from './pr-risk-outcome';
import {
  computeMonthlyMetric,
  isMonthlyReviewDue,
  monthBounds,
  previousMonthKey,
  proposeThreshold,
  shouldAdopt,
  shouldDemote,
  type MonthlyMetric,
} from './pr-risk-metrics';
import { train } from './pr-risk-model';
import {
  createThresholdReview,
  defaultDb,
  findMonthlyMetric,
  listLabelledPredictions,
  listTrainingRows,
  listUnsettledOutcomes,
  readConfig,
  upsertMonthlyMetric,
  upsertOutcome,
  writeConfig,
  type PrRiskDb,
} from './pr-risk-store';

/** Retraining needs this many settled labels, of which this many failures. */
const MIN_TRAIN_LABELS = 30;
const MIN_TRAIN_FAILURES = 5;
const REVIEW_WINDOW_MONTHS = 3;

export interface ReviewJobDeps extends Pick<OutcomeDeps, 'viewPr' | 'gitLog'> {
  db: PrRiskDb;
  now: () => Date;
  log: { warn: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void };
}

interface GhPrView {
  title: string;
  mergedAt: string | null;
  mergeCommit: { oid: string } | null;
  baseRefName: string;
  commits?: Array<{ oid: string }>;
}

interface GhCommit {
  sha: string;
  commit: { message: string; committer: { date: string } };
}

function defaultDeps(): ReviewJobDeps {
  // NOTE: The job has no repo checkout (PRs span projects), so the base-branch
  // history comes from the GitHub API and is re-serialised into the
  // `%H%x1f%cI%x1f%B%x1e` git-log format parseRevertLog consumes.
  return {
    db: defaultDb,
    now: () => new Date(),
    log: createLogger('self-improvement:pr-risk-review-job'),
    viewPr: async (repo, prNumber) => {
      const out = await runGhCommand(
        [
          'pr',
          'view',
          String(prNumber),
          '--repo',
          repo,
          '--json',
          'title,mergedAt,mergeCommit,baseRefName,commits',
        ],
        undefined,
        { skipLog: true },
      );
      const v = JSON.parse(out) as GhPrView;
      return {
        title: v.title,
        mergedAt: v.mergedAt,
        mergeSha: v.mergeCommit?.oid ?? null,
        baseBranch: v.baseRefName,
        commitShas: (v.commits ?? []).map((c) => c.oid),
      };
    },
    gitLog: async (repo, baseBranch, sinceIso) => {
      const out = await runGhCommand(
        [
          'api',
          '-X',
          'GET',
          `repos/${repo}/commits`,
          '-f',
          `sha=${baseBranch}`,
          '-f',
          `since=${sinceIso}`,
          '-f',
          'per_page=100',
        ],
        undefined,
        { skipLog: true },
      );
      return (JSON.parse(out) as GhCommit[])
        .map((c) => `${c.sha}\x1f${c.commit.committer.date}\x1f${c.commit.message}\x1e`)
        .join('\n');
    },
  };
}

async function stage<T>(
  deps: ReviewJobDeps,
  name: string,
  fallback: T,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    deps.log.warn({ err, stage: name }, '[pr-risk-review-job] stage failed — continuing');
    return fallback;
  }
}

/**
 * Run one PR-risk monitoring pass.
 *
 * @param deps - Injectable side effects / 依存注入
 * @returns Labels settled + metric rows + review rows / 記録件数
 */
export async function runPrRiskReviewJob(deps: ReviewJobDeps = defaultDeps()): Promise<number> {
  const now = deps.now();

  const settled = await stage(deps, 'labels', 0, async () => {
    const pending = await listUnsettledOutcomes(deps.db);
    return collectOutcomes(
      pending.map((o) => ({ repo: o.repo, prNumber: o.prNumber, incidentNote: o.incidentNote })),
      { ...deps, now: deps.now, saveOutcome: (row) => upsertOutcome(deps.db, row, now) },
    );
  });

  if (!isMonthlyReviewDue(now)) return settled;
  const month = previousMonthKey(now);

  // The metric row doubles as the "this month was reviewed" marker, so the
  // weekly schedule yields exactly one metric + one review per month.
  const metric = await stage<MonthlyMetric | null>(deps, 'metrics', null, async () => {
    if (await findMonthlyMetric(deps.db, month)) return null;
    const { start, end } = monthBounds(month);
    const m = computeMonthlyMetric(await listLabelledPredictions(deps.db, start, end));
    const config = await readConfig(deps.db);
    await upsertMonthlyMetric(deps.db, {
      ...m,
      month,
      threshold: config.threshold,
      modelVersion: config.modelVersion,
    });
    return m;
  });
  if (!metric) return settled;

  await stage(deps, 'retrain', 0, async () => {
    const rows = await listTrainingRows(deps.db);
    const failures = rows.filter((r) => r.label === 'failure').length;
    if (rows.length < MIN_TRAIN_LABELS || failures < MIN_TRAIN_FAILURES) return 0;
    const { modelVersion } = await readConfig(deps.db);
    await writeConfig(deps.db, {
      modelJson: JSON.stringify(train(rows)),
      modelVersion: modelVersion + 1,
    });
    return 1;
  });

  const reviewed = await stage(deps, 'threshold', 0, async () => {
    const config = await readConfig(deps.db);
    const { end } = monthBounds(month);
    const windowStart = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - REVIEW_WINDOW_MONTHS, 1),
    );
    const proposal = proposeThreshold(await listLabelledPredictions(deps.db, windowStart, end));
    const demote = shouldDemote({
      stage: config.stage,
      sample: metric.sample,
      precision: metric.precision,
    });
    const adopt =
      !demote &&
      shouldAdopt({
        stage: config.stage,
        modelVersion: config.modelVersion,
        proposed: proposal.proposed,
        current: config.threshold,
      });
    if (demote) await writeConfig(deps.db, { stage: 'hold', stageChangedAt: now });
    else if (adopt && proposal.proposed !== null)
      await writeConfig(deps.db, { threshold: proposal.proposed });
    await createThresholdReview(deps.db, {
      month,
      previousThreshold: config.threshold,
      proposedThreshold: proposal.proposed,
      adopted: adopt,
      reason: demote ? 'demoted_low_precision' : proposal.reason,
      sample: metric.sample,
    });
    return 1;
  });

  deps.log.info({ settled, month, reviewed }, '[pr-risk-review-job] pass complete');
  return settled + 1 + reviewed;
}
