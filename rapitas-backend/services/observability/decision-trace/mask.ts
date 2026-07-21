/**
 * decision-trace/mask
 *
 * Sensitive-data masking for decision-audit payloads. Scans object keys
 * (credential-like names) and string values (known secret token shapes)
 * recursively before anything is persisted. Not responsible for size
 * capping — the recorder truncates after serialization.
 */

/** Object keys whose values are replaced wholesale with "[REDACTED]". */
const SENSITIVE_KEY_RE =
  /api[_-]?key|token|secret|password|passwd|authorization|credential|private[_-]?key/i;

/**
 * Secret-shaped substrings replaced inside string values regardless of key.
 * NOTE: Patterns are provider-specific formats (Anthropic/OpenAI `sk-`,
 * GitHub PAT `ghp_`, HTTP `Bearer`, AWS `AKIA`) plus URL-embedded
 * credentials (`scheme://user:pass@` — covers DB connection strings such as
 * `postgres://`) — extend here when a new credential format appears in
 * decision inputs.
 */
const SENSITIVE_VALUE_RES: RegExp[] = [
  /sk-[A-Za-z0-9]{20,}/g,
  /ghp_[A-Za-z0-9]{36}/g,
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /AKIA[0-9A-Z]{16}/g,
  // userinfo portion of any URL (postgres://user:pass@host, https://u:p@host, …).
  // Requires the ":pass@" part so plain credential-free URLs stay untouched.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s@]+@/gi,
];

const REDACTED = '[REDACTED]';

/** Result of a masking pass. */
export interface MaskResult {
  /** Deep copy of the input with sensitive parts replaced. */
  masked: unknown;
  /** Number of keys/values that were redacted (observability aid). */
  maskedFieldCount: number;
}

/**
 * Replaces secret-shaped substrings inside a string value.
 *
 * @param value - Raw string value / 生の文字列値
 * @returns Masked string and how many replacements happened / マスク済み文字列と置換件数
 */
export function maskStringValue(value: string): { masked: string; count: number } {
  let masked = value;
  let count = 0;
  for (const re of SENSITIVE_VALUE_RES) {
    masked = masked.replace(re, () => {
      count += 1;
      return REDACTED;
    });
  }
  return { masked, count };
}

/**
 * Recursively masks sensitive keys and secret-shaped string values.
 *
 * @param value - Any JSON-serializable value (raw, unmasked) / マスク前の任意の値
 * @returns Masked deep copy plus the number of redactions / マスク済みコピーと置換件数
 */
export function maskSensitive(value: unknown): MaskResult {
  let maskedFieldCount = 0;
  // Circular structures cannot be JSON-persisted anyway; cut the cycle with a
  // placeholder instead of recursing forever.
  const seen = new WeakSet<object>();

  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const { masked, count } = maskStringValue(v);
      maskedFieldCount += count;
      return masked;
    }
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[Circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(v)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        maskedFieldCount += 1;
        out[key] = REDACTED;
      } else {
        out[key] = walk(child);
      }
    }
    return out;
  };

  return { masked: walk(value), maskedFieldCount };
}
