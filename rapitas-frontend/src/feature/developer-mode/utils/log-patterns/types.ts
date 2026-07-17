/**
 * log-patterns/types
 *
 * Shared rule shape for the log-classification pattern table.
 * Pure type definitions only; the rule groups live in the sibling modules.
 */

import type { UserFriendlyLogEntry } from '../log-pattern-rules';

/** A single ordered classification rule (most-specific rules come first). */
export interface LogPatternRule {
  pattern: RegExp;
  transform: (log: string, match: RegExpMatchArray) => UserFriendlyLogEntry;
}
