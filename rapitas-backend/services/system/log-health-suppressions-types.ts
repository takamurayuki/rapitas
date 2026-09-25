/**
 * log-health-suppressions-types
 *
 * Shared type for one suppression rule, used by both the rule table
 * (log-health-suppression-rules.ts) and the classifier (log-health-suppressions.ts).
 */

/** One suppression rule and the reason it is safe to drop the line. */
export interface Suppression {
  /** Matches the normalized message (and optionally the logger name). */
  test: RegExp;
  /** Restrict to one logger when the phrase alone is too broad. */
  logger?: RegExp;
  /** When matched, this line is NOT suppressed even if `test` also matches. */
  exclude?: RegExp;
  /** Why this line leaves nothing broken. Shown in the audit log. */
  because: string;
}
