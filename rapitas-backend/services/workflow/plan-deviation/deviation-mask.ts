/**
 * plan-deviation/deviation-mask
 *
 * Masks secrets in operation display strings, log-context lines and audit
 * comments before they are shown or persisted. Wraps the decision-trace
 * masker and adds shapes that appear in shell logs (env assignments, JWTs,
 * extra token prefixes) without widening the decision-trace masker itself.
 */
import { maskStringValue } from '../../observability/decision-trace/mask';

const REDACTED = '[REDACTED]';

/**
 * `NAME=value` where NAME looks credential-like. The name is kept so the log
 * stays readable; only the value is replaced.
 */
const ENV_ASSIGNMENT_RE =
  /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH)[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s"']+)/gi;

/**
 * Additional secret-shaped tokens not covered by decision-trace/mask.ts.
 * NOTE: JWT = three base64url segments starting with `eyJ` (a JSON header);
 * `github_pat_` / `xox?-` are GitHub fine-grained and Slack token formats.
 */
const EXTRA_VALUE_RES: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
];

/**
 * Replace secret-shaped substrings in a display/log/comment string.
 *
 * @param text - Raw text that may contain secrets / 秘密情報を含みうる生テキスト
 * @returns Text with every recognized secret replaced by `[REDACTED]` / マスキング済みテキスト
 */
export function maskDeviationText(text: string): string {
  let masked = text.replace(ENV_ASSIGNMENT_RE, (_m, name: string) => `${name}=${REDACTED}`);
  masked = maskStringValue(masked).masked;
  for (const re of EXTRA_VALUE_RES) masked = masked.replace(re, REDACTED);
  return masked;
}
