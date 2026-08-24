/**
 * pii-risk/mitigate
 *
 * Staged mitigation of risky error-log content: PII masking (medium+),
 * truncation (high+), and context filtering (critical). Not responsible
 * for scoring — callers pass the RiskLevel from risk-assessor.
 */

import { PII_PATTERNS } from './pii-detector';
import type { RiskLevel } from './risk-assessor';

/** Max chars kept when truncation applies (high / critical). */
export const PII_TRUNCATE_MAX_CHARS = 2048;
/** Suffix appended to truncated text. */
export const TRUNCATED_SUFFIX = '…[truncated]';

/**
 * Applies level-staged mitigation to a text: PII masking at medium and
 * above, plus truncation at high and above.
 *
 * @param text - Text to mitigate / 対象テキスト
 * @param level - Risk level from assessRisk / リスクレベル
 * @returns Mitigated text; unchanged when level is low / 処理済みテキスト
 */
export function mitigateText(text: string, level: RiskLevel): string {
  if (level === 'low') return text;
  let out = text;
  for (const { type, re } of PII_PATTERNS) {
    out = out.replace(re, `[REDACTED:${type.toUpperCase()}]`);
  }
  if ((level === 'high' || level === 'critical') && out.length > PII_TRUNCATE_MAX_CHARS) {
    out = out.slice(0, PII_TRUNCATE_MAX_CHARS) + TRUNCATED_SUFFIX;
  }
  return out;
}

/**
 * Applies level-staged mitigation to a context object: at critical the
 * whole value set is dropped (keys only survive); at medium/high every
 * string leaf is masked via mitigateText.
 *
 * NOTE: The recursive walk intentionally duplicates decision-trace/mask.ts
 * (which stays decision-trace-specific by design) — a future unification is
 * a separate task, not this one.
 *
 * @param context - Free-form error context / 自由形式のエラーコンテキスト
 * @param level - Risk level from assessRisk / リスクレベル
 * @returns Mitigated copy, the original (low), or a filtered stub (critical) / 処理結果
 */
export function mitigateContext(
  context: Record<string, unknown> | undefined,
  level: RiskLevel,
): Record<string, unknown> | undefined {
  if (context === undefined) return context;
  if (level === 'critical') {
    // Free-form nested input can defeat per-string masking at extreme risk —
    // drop the values wholesale and keep only the key list for debugging.
    return { __filtered: true, reason: 'risk_score_critical', originalKeys: Object.keys(context) };
  }
  if (level === 'low') return context;

  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return mitigateText(v, level);
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[Circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(v)) {
      out[key] = walk(child);
    }
    return out;
  };
  return walk(context) as Record<string, unknown>;
}
