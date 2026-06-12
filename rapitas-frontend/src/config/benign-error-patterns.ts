/**
 * benign-error-patterns
 *
 * Defines BenignErrorPattern entries and matchesPattern() used by
 * GlobalErrorReporter to suppress known-harmless browser errors before
 * reporting them to /system/errors.
 * Does NOT handle routing, persistence, or UI — those belong to other modules.
 */

/**
 * A single entry in the benign-error suppression list.
 *
 * @param pattern - The string to match against the error message.
 * @param mode - 'prefix' (default): message.startsWith(pattern). 'contains': message.includes(pattern).
 * @param ua - Optional substring of navigator.userAgent. When set, the entry only suppresses
 *             errors on user agents whose UA string includes this value (partial, case-sensitive).
 *             When omitted, the entry applies to all user agents.
 * @param env - Optional array of NODE_ENV values. When set, only suppresses errors in the
 *             listed environments. When omitted, the entry applies to all environments.
 * @param note - Required. Explains why this error is benign (for maintainers).
 */
export interface BenignErrorPattern {
  pattern: string;
  mode?: 'prefix' | 'contains';
  ua?: string;
  env?: string[];
  note: string;
}

/**
 * Known-benign error patterns suppressed before reporting to /system/errors.
 *
 * Criteria for inclusion — ALL three must hold:
 *   1. Known: documented browser/framework behaviour.
 *   2. Harmless: no data loss, incorrect state, or user-visible breakage.
 *   3. Duplicate-noise: generates repeated actionless noise in monitoring.
 *
 * Adding a new entry:
 *   1. Verify the three criteria above.
 *   2. Set `note` to explain why the error is benign (1 line, required).
 *   3. Set `ua` only when the error is browser-specific; omit for cross-browser entries.
 *   4. Set `env` only when the error is environment-specific; omit for production-relevant entries.
 *   5. Use `mode: 'contains'` only when the target string never appears at message start;
 *      default 'prefix' is safer and avoids accidental suppression.
 *   6. Update docs/design/global-error-reporter-filter.md in the same commit.
 *
 * NOTE: This file is the single source of truth for benign-error patterns.
 *       Backend equivalent: rapitas-backend/services/agents/cli-output-filter.ts (separate lifecycle).
 */
export const BENIGN_ERROR_PATTERNS: readonly BenignErrorPattern[] = [
  {
    pattern: 'ResizeObserver loop limit exceeded',
    note: 'Chrome/Edge: ResizeObserver fires when callbacks cannot complete within one animation frame. Browser retries automatically; no data loss or UI breakage occurs.',
  },
  {
    pattern: 'ResizeObserver loop completed with undelivered notifications.',
    note: 'Firefox/Safari variant of the ResizeObserver timing message. Equally harmless — browser retries automatically.',
  },
  {
    pattern: 'Script error.',
    note: 'Cross-origin <script> errors: browsers redact all details for security. The empty "Script error." string carries no actionable information.',
  },
];

/**
 * Returns true when a single BenignErrorPattern matches the given message and context.
 *
 * Context evaluation rules:
 *   - ctx absent: UA/env constraints are skipped entirely (backward-compatible path for callers
 *     that pass only the message string).
 *   - ctx.ua absent (navigator unavailable / SSR): UA constraint is skipped.
 *   - ctx.env absent: env constraint is skipped.
 *   - entry.ua absent: entry applies to all user agents.
 *   - entry.env absent or empty: entry applies to all environments.
 *
 * @param entry - A single BenignErrorPattern to evaluate.
 * @param message - The error message string.
 * @param ctx - Optional context carrying the current user-agent string and NODE_ENV.
 * @returns true when the entry matches and the error should be suppressed.
 */
export function matchesPattern(
  entry: BenignErrorPattern,
  message: string,
  ctx?: { ua?: string; env?: string },
): boolean {
  const patternMatches =
    entry.mode === 'contains' ? message.includes(entry.pattern) : message.startsWith(entry.pattern);
  if (!patternMatches) return false;

  // NOTE: ctx absent → skip UA/env constraints to preserve backward compatibility.
  if (ctx === undefined) return true;

  // NOTE: UA constraint skipped when ctx.ua is undefined — ensures SSR/jsdom safety.
  if (entry.ua !== undefined && ctx.ua !== undefined) {
    if (!ctx.ua.includes(entry.ua)) return false;
  }

  if (entry.env !== undefined && entry.env.length > 0 && ctx.env !== undefined) {
    if (!entry.env.includes(ctx.env)) return false;
  }

  return true;
}
