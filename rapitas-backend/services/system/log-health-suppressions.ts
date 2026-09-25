/**
 * log-health-suppressions
 *
 * Decides which log lines are worth filing as concerns.
 *
 * The health check used to file every warn-or-worse line it saw. Measured
 * 2026-08-27 on the rapitas backlog: 60 of 121 open concerns came from this
 * path, and almost none named anything that was left broken — a guard refusing
 * an unsafe branch switch, a reconciler recovering a starved queue, an optional
 * provider being absent. Those lines are the system WORKING.
 *
 * The rule this module encodes: a log line is a concern only when something was
 * left broken. A guard that refused, a recovery that succeeded, and a fail-open
 * that continued all leave nothing to fix, however alarming the wording.
 *
 * The rule table itself lives in log-health-suppression-rules.ts (task 1040 —
 * split out to stay under the COMPONENT_SPLITTING_POLICY line-count ratchet).
 *
 * NOTE (task 1043): the verification-gate suppression rule in
 * log-health-suppression-rules.ts must match all three wordings emitted for
 * the same underlying event — "blocking", "aborting auto-commit/PR", and
 * "holding the local commit, no push/PR" (workflow-auto-commit.ts:272) — so
 * that none of them slip through and get re-filed as new concerns.
 */
import { SUPPRESSIONS } from './log-health-suppression-rules';

export type { Suppression } from './log-health-suppressions-types';

/** Result of classifying one log signature. */
export interface SuppressionVerdict {
  /** True when the line should NOT become a concern. */
  suppressed: boolean;
  /** Why, when suppressed. */
  because?: string;
}

/**
 * Whether a log line reports something that was left broken.
 *
 * @param name - Logger name. / ロガー名
 * @param normalizedMsg - Normalized message body. / 正規化済みメッセージ
 * @returns Verdict with the reason when suppressed. / 判定と理由
 */
export function classifyLogSignature(name: string, normalizedMsg: string): SuppressionVerdict {
  for (const rule of SUPPRESSIONS) {
    if (rule.logger && !rule.logger.test(name)) continue;
    if (rule.exclude && rule.exclude.test(normalizedMsg)) continue;
    if (rule.test.test(normalizedMsg)) return { suppressed: true, because: rule.because };
  }
  return { suppressed: false };
}
