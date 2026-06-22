/**
 * Critique Aggregator
 *
 * Pure aggregation of per-lens critic verdicts into a single gate decision.
 * No IO — the testable core of the phase-critic gate.
 */
import type { CriticVerdict, PhaseCritiqueResult } from './phase-critic-types';

/** Severity at/above which a single lens failing is enough to fail the gate. */
export const SEVERE_THRESHOLD = 80;
/** Max issues carried into the bounce feedback. */
const MAX_REASONS = 8;

/**
 * Combine lens verdicts. The gate FAILS when a majority of lenses fail OR any
 * single lens reports a severe (≥ {@link SEVERE_THRESHOLD}) problem. With no
 * verdicts (critics unavailable) the result is 'unknown' so the caller fails open.
 *
 * @param verdicts - Per-lens verdicts. / レンズ別の判定
 * @returns The aggregated gate result. / 集約後のゲート結果
 */
export function aggregateCritiques(verdicts: CriticVerdict[]): PhaseCritiqueResult {
  if (verdicts.length === 0) return { verdict: 'unknown', severity: 0, reasons: [] };

  const fails = verdicts.filter((v) => !v.pass);
  const majorityFail = fails.length * 2 > verdicts.length;
  const severeFail = fails.some((v) => v.severity >= SEVERE_THRESHOLD);
  const severity = verdicts.reduce((max, v) => Math.max(max, v.severity), 0);

  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const v of fails) {
    for (const issue of v.issues) {
      const trimmed = issue.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      reasons.push(`[${v.lens}] ${trimmed}`);
      if (reasons.length >= MAX_REASONS) break;
    }
    if (reasons.length >= MAX_REASONS) break;
  }

  return { verdict: majorityFail || severeFail ? 'fail' : 'pass', severity, reasons };
}
