/**
 * decision-ledger/tier-outcomes
 *
 * Answers "did paying for a stronger tier buy anything for this role?" from the
 * ledger's own verdicts.
 *
 * The routing evidence layer has always answered this from raw execution
 * statuses. That counts a run as a failure whether the model was outmatched or
 * the spend limit ran out, so an upgrade could look unjustified because the
 * infrastructure wobbled. The ledger already separates those: an
 * infrastructure failure settles as indeterminate, not as a wrong decision.
 */

import { readDecisions } from './query';
import type { Decision } from './types';

/** Outcomes for one tier, counted from settled decisions only. */
export interface TierOutcome {
  tier: string;
  /** Decisions with a real verdict — indeterminate and pending are excluded. */
  samples: number;
  /** Of those, how many were borne out. */
  correct: number;
  /** correct / samples. */
  rate: number;
}

/** How far back the ledger is asked. Matches the evidence layer's own window. */
const WINDOW_DAYS = 14;

/** Read the role a decision was made for, as recorded on the trace. */
function roleOf(d: Decision): string | null {
  const p = d.predicted as { role?: unknown } | null;
  return p && typeof p.role === 'string' ? p.role : null;
}

/** Read the tier that was adopted. */
function tierOf(d: Decision): string | null {
  const p = d.predicted as { tier?: unknown } | null;
  return p && typeof p.tier === 'string' ? p.tier : null;
}

/**
 * Per-tier settled outcomes for one workflow role.
 *
 * Only `correct` and `wrong` count. A decision the checker could not attribute
 * — a spend limit, a timeout, an upstream 5xx — contributes to neither, because
 * it says nothing about the tier that was chosen.
 *
 * @param role - Workflow role. / ワークフローのロール
 * @param days - Lookback window. / 遡る日数
 * @returns One entry per tier that has settled decisions. / ティアごとの実績
 */
export async function tierOutcomesForRole(
  role: string,
  days: number = WINDOW_DAYS,
): Promise<TierOutcome[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const decisions = await readDecisions({ kinds: ['model_tier'], since, limit: 1000 });

  const byTier = new Map<string, { samples: number; correct: number }>();
  for (const d of decisions) {
    if (roleOf(d) !== role) continue;
    const tier = tierOf(d);
    if (!tier) continue;
    if (d.verdict !== 'correct' && d.verdict !== 'wrong') continue;
    const acc = byTier.get(tier) ?? { samples: 0, correct: 0 };
    acc.samples += 1;
    if (d.verdict === 'correct') acc.correct += 1;
    byTier.set(tier, acc);
  }

  return [...byTier].map(([tier, a]) => ({
    tier,
    samples: a.samples,
    correct: a.correct,
    rate: a.samples > 0 ? a.correct / a.samples : 0,
  }));
}
