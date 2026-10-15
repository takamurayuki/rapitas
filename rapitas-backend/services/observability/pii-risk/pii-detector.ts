/**
 * pii-risk/pii-detector
 *
 * Structural PII pattern detection for error-log content. Detects only
 * delimiter-bearing shapes (email, hyphenated phone numbers, grouped card
 * numbers) so undelimited digit runs (timestamps, IDs, ports) never match.
 * Not responsible for scoring or masking — see risk-assessor / mitigate.
 */

/** Kinds of PII this module can detect. */
export type PiiType = 'email' | 'phone_jp' | 'phone_intl' | 'credit_card';

/** One detected PII kind and how many times it matched. */
export interface PiiHit {
  type: PiiType;
  count: number;
}

/**
 * Detection patterns. Every pattern requires delimiter characters
 * (`@` / `-` / `.` / space / `+`) as part of the structural match — a bare
 * digit sequence such as a port number or epoch timestamp cannot match.
 * All patterns carry the `g` flag so match counts reflect every occurrence.
 */
export const PII_PATTERNS: { type: PiiType; re: RegExp }[] = [
  // Local part capped at 64 chars (RFC 5321 limit) — an unbounded `+` makes the
  // scan O(n²) on long alphanumeric runs, which would stall the log hot path.
  { type: 'email', re: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,}/g },
  // Japanese domestic numbers: leading 0, two hyphens (03-1234-5678, 090-1234-5678).
  { type: 'phone_jp', re: /\b0\d{1,4}-\d{1,4}-\d{3,4}\b/g },
  // International numbers: +CC then 2-4 delimiter-separated digit groups.
  { type: 'phone_intl', re: /\+\d{1,3}(?:[-. ]\d{1,4}){2,4}\b/g },
  // Card-shaped: four delimiter-separated digit groups (no Luhn check — see plan).
  { type: 'credit_card', re: /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{1,4}\b/g },
];

/**
 * Scans a text for structural PII patterns.
 *
 * @param text - Text to scan (already secret-masked upstream) / 走査対象テキスト
 * @returns Hits per detected type; types with zero matches are omitted / 検出タイプ別ヒット
 */
export function detectPii(text: string): PiiHit[] {
  if (!text) return [];
  const hits: PiiHit[] = [];
  for (const { type, re } of PII_PATTERNS) {
    const matches = text.match(re);
    if (matches && matches.length > 0) {
      hits.push({ type, count: matches.length });
    }
  }
  return hits;
}
