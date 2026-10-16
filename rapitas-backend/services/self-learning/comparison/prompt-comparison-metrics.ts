/**
 * PromptComparisonMetrics
 *
 * Pure aggregation and judgement logic for the prompt comparison system:
 * failure-cause classification, per-arm aggregation and the improved /
 * regressed / inconclusive / insufficient_data verdict. No I/O, no clock —
 * fixture-testable, mirroring the experiment-metrics.ts separation.
 */
import type {
  ComparisonArm,
  ComparisonCell,
  ComparisonRun,
  ComparisonSummary,
  ComparisonVerdict,
  FailureCause,
} from './prompt-comparison-types';

/** Minimum successful+failed samples required to judge a candidate (distinct from prompt-evolution-runner's MIN_SAMPLE_SIZE trigger threshold). */
export const COMPARISON_MIN_SAMPLE = 5;

/** Success-rate delta magnitude that separates improved/regressed from noise. */
export const COMPARISON_IMPROVE_THRESHOLD = 0.05;

/** Cost worsening fraction beyond which a candidate is not called "improved". */
export const COMPARISON_COST_TOLERANCE = 0.2;

/** Default one-sided significance level for a single (non-repeated) verdict call. */
export const COMPARISON_SIGNIFICANCE_ALPHA = 0.05;

/** Duration worsening fraction beyond which a candidate is not called "improved". */
export const COMPARISON_DURATION_TOLERANCE = 0.2;

/** Infra-failure signatures that mark a run's failure as environment-caused, not prompt-caused. */
const INFRA_FAILURE_PATTERN =
  /ECONNRESET|529|ETIMEDOUT|rate.?limit|Overloaded|ECONNREFUSED|ENOTFOUND/i;

/**
 * Classify why a shadow-run execution did not succeed. Preliminary regex —
 * spot-check against real failed executions before trusting the split.
 *
 * @param execution - Execution status/errorMessage from AgentExecution. / 実行のstatus/errorMessage
 * @returns Failure cause, or null when the execution succeeded. / 失敗原因（成功時はnull）
 */
export function classifyFailureCause(execution: {
  status: string;
  errorMessage: string | null;
}): FailureCause | null {
  if (execution.status === 'completed') return null;
  if (execution.status === 'cancelled') return 'user_cancelled';
  if (INFRA_FAILURE_PATTERN.test(execution.errorMessage ?? '')) return 'infra_failure';
  return 'implementation_error';
}

/** Per-arm aggregate used before computing the current-vs-candidate summary. */
interface ArmAggregate {
  successRate: number;
  avgCostUsd: number;
  avgDurationMs: number;
  /** Runs counted toward successRate/avgCostUsd/avgDurationMs (infra_failure excluded). */
  sampleSize: number;
  successCount: number;
  excludedForInfraFailure: number;
}

/**
 * Aggregate one arm's runs, excluding infra_failure runs from the success-rate
 * and cost/duration means (they measure infrastructure, not the prompt).
 *
 * @param runs - Shadow runs for one (arm, knowledge) cell. / 1セル分の実行結果
 * @returns Aggregate with infra failures excluded from the denominator. / 基盤障害を除外した集計
 */
export function aggregateArm(runs: ComparisonRun[]): ArmAggregate {
  const counted = runs.filter((r) => r.failureCause !== 'infra_failure');
  const excludedForInfraFailure = runs.length - counted.length;
  if (counted.length === 0) {
    return {
      successRate: 0,
      avgCostUsd: 0,
      avgDurationMs: 0,
      sampleSize: 0,
      successCount: 0,
      excludedForInfraFailure,
    };
  }
  const successCount = counted.filter((r) => r.success).length;
  const costTotal = counted.reduce((sum, r) => sum + r.costUsd, 0);
  const durationTotal = counted.reduce((sum, r) => sum + r.durationMs, 0);
  return {
    successRate: successCount / counted.length,
    avgCostUsd: costTotal / counted.length,
    avgDurationMs: durationTotal / counted.length,
    sampleSize: counted.length,
    successCount,
    excludedForInfraFailure,
  };
}

/**
 * Natural log of n! computed via a running sum (avoids overflow for n > 170,
 * where a direct factorial becomes Infinity).
 *
 * @param n - Non-negative integer. / 非負整数
 * @returns ln(n!). / ln(n!)
 */
function logFactorial(n: number): number {
  let sum = 0;
  for (let i = 2; i <= n; i++) sum += Math.log(i);
  return sum;
}

/**
 * Log of the binomial coefficient C(n, r), computed in log-space to avoid
 * overflow for large n.
 *
 * @param n - Total count. / 総数
 * @param r - Chosen count. / 選択数
 * @returns ln(C(n, r)). / ln(C(n, r))
 */
function logChoose(n: number, r: number): number {
  if (r < 0 || r > n) return -Infinity;
  return logFactorial(n) - logFactorial(r) - logFactorial(n - r);
}

/**
 * One-sided Fisher exact test p-value for "candidate success rate is greater
 * than current success rate", computed from the 2x2 contingency table
 * directly in log-space (no reliance on the binomial-proportion standard
 * error, which degenerates to 0 when either arm is at 0%/100%).
 *
 * @param candidateSuccess - Candidate arm success count. / 候補群の成功数
 * @param candidateFailure - Candidate arm failure count. / 候補群の失敗数
 * @param currentSuccess - Current arm success count. / 現行群の成功数
 * @param currentFailure - Current arm failure count. / 現行群の失敗数
 * @returns One-sided p-value in [0, 1]. / 片側p値
 */
export function fisherExactOneSidedGreater(
  candidateSuccess: number,
  candidateFailure: number,
  currentSuccess: number,
  currentFailure: number,
): number {
  const n1 = candidateSuccess + candidateFailure;
  const n2 = currentSuccess + currentFailure;
  const bigK = candidateSuccess + currentSuccess;
  const bigN = n1 + n2;
  if (n1 === 0 || n2 === 0 || bigN === 0) return 1;

  const logDenom = logChoose(bigN, n1);
  const maxX = Math.min(n1, bigK);
  let pValue = 0;
  for (let x = candidateSuccess; x <= maxX; x++) {
    pValue += Math.exp(logChoose(bigK, x) + logChoose(bigN - bigK, n1 - x) - logDenom);
  }
  return Math.min(1, Math.max(0, pValue));
}

/**
 * Decide the comparison verdict from a current-vs-candidate summary
 * (regression checked before improvement, matching judgeExperiment's ordering
 * so a success-rate gain bought with a significant cost/duration regression
 * still does not count as "improved"). Regression stays magnitude-only
 * (no significance gate) by design — blocking a regressing candidate should
 * stay conservative, while approving an "improved" one is gated by a
 * one-sided Fisher exact test so the verdict does not depend on the
 * binomial-proportion standard error, which degenerates to 0 when either arm
 * sits at 0%/100%.
 *
 * @param s - Aggregated summary (verdict/uncertainty/pValue fields are not read). / 集計済みサマリ
 * @param alpha - One-sided significance level for the improvement gate. / 有意水準
 * @returns The comparison verdict. / 比較判定
 */
export function decideComparisonVerdict(
  s: Omit<ComparisonSummary, 'verdict' | 'uncertainty' | 'pValue'>,
  alpha: number = COMPARISON_SIGNIFICANCE_ALPHA,
): ComparisonVerdict {
  if (s.sampleSize < COMPARISON_MIN_SAMPLE) return 'insufficient_data';
  if (s.successRateDelta <= -COMPARISON_IMPROVE_THRESHOLD) return 'regressed';
  const costOk = s.costDelta <= COMPARISON_COST_TOLERANCE;
  const durationOk = s.durationDeltaMs <= s.baselineDurationMs * COMPARISON_DURATION_TOLERANCE;
  if (s.successRateDelta >= COMPARISON_IMPROVE_THRESHOLD && costOk && durationOk) {
    const pValue = fisherExactOneSidedGreater(
      s.candidateSuccessCount,
      s.candidateFailureCount,
      s.currentSuccessCount,
      s.currentFailureCount,
    );
    if (pValue < alpha) return 'improved';
  }
  return 'inconclusive';
}

/**
 * Build the full comparison summary from the two `knowledge=with` cells
 * (current vs candidate) — the primary comparison axis per plan.md; the
 * `without` cells are recorded in the ComparisonRecord but do not feed the
 * adoption verdict.
 *
 * @param cells - All four (arm × knowledge) cells for one candidate. / 全4セル
 * @returns Summary with verdict, or null when the `with` cells are missing. / サマリ（with系セル欠如時はnull）
 */
export function buildComparisonSummary(cells: ComparisonCell[]): ComparisonSummary | null {
  const currentWith = findCell(cells, 'current', 'with');
  const candidateWith = findCell(cells, 'candidate', 'with');
  if (!currentWith || !candidateWith) return null;

  const current = aggregateArm(currentWith.runs);
  const candidate = aggregateArm(candidateWith.runs);

  const base: Omit<ComparisonSummary, 'verdict' | 'uncertainty' | 'pValue'> = {
    successRateDelta: candidate.successRate - current.successRate,
    costDelta: candidate.avgCostUsd - current.avgCostUsd,
    durationDeltaMs: candidate.avgDurationMs - current.avgDurationMs,
    baselineDurationMs: current.avgDurationMs,
    sampleSize: Math.min(current.sampleSize, candidate.sampleSize),
    excludedForInfraFailure: current.excludedForInfraFailure + candidate.excludedForInfraFailure,
    currentSuccessCount: current.successCount,
    currentFailureCount: current.sampleSize - current.successCount,
    candidateSuccessCount: candidate.successCount,
    candidateFailureCount: candidate.sampleSize - candidate.successCount,
  };
  const verdict = decideComparisonVerdict(base);
  const pValue =
    base.sampleSize < COMPARISON_MIN_SAMPLE
      ? null
      : fisherExactOneSidedGreater(
          base.candidateSuccessCount,
          base.candidateFailureCount,
          base.currentSuccessCount,
          base.currentFailureCount,
        );
  const uncertainty: ComparisonSummary['uncertainty'] =
    verdict === 'insufficient_data'
      ? 'high'
      : base.sampleSize < COMPARISON_MIN_SAMPLE + 2
        ? 'medium'
        : 'low';

  return { ...base, verdict, uncertainty, pValue };
}

function findCell(
  cells: ComparisonCell[],
  arm: ComparisonArm,
  knowledge: ComparisonCell['knowledge'],
): ComparisonCell | undefined {
  return cells.find((c) => c.arm === arm && c.knowledge === knowledge);
}
