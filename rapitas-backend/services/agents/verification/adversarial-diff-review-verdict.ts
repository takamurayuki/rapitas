/**
 * adversarial-diff-review-verdict
 *
 * Verdict types, the parser for one juror's reply, and the majority-vote
 * aggregation across jurors. Pure; the jury orchestration (providers, timeouts,
 * diff assembly) lives in adversarial-diff-review.ts.
 */
import type { AIProvider } from '../../../utils/ai-client/types';
import { NON_VERDICT_REASON_RE } from './adversarial-diff-review-prompt';

export type ReviewVerdict = 'pass' | 'fail' | 'unknown';

/** One juror's independent verdict (provider = model family). */
export interface JurorVerdict {
  provider: AIProvider;
  verdict: ReviewVerdict;
  severity: number;
  reasons: string[];
}

export interface DiffReviewResult {
  /** 'fail' = the diff does NOT satisfy the task; 'unknown' = jury unavailable. */
  verdict: ReviewVerdict;
  /** 0-100; higher = more serious. Only meaningful for 'fail'. */
  severity: number;
  /** Short human-readable reasons (used as self-repair feedback). */
  reasons: string[];
  /** True when at least one juror actually evaluated the diff. */
  judged: boolean;
  /** Individual juror verdicts — recorded for future reliability weighting. */
  jurors?: JurorVerdict[];
}

/**
 * Whether a "fail" rests on nothing but notes the prompt told the juror must
 * not drive the verdict ("要確認:" asides about code outside the diff,
 * "管轄外:" criteria that cannot be decided from a diff). Jurors write the
 * prefix and then fail anyway: in the week to 2026-09-20, log-triage tasks
 * 944/961/983 were bounced for "ログ出力箇所が差分に示されていない" and
 * watcher tasks 979/997 for runtime outcomes, every reason so prefixed or
 * phrased. A fail with no decisive reason is downgraded to pass here so the
 * prompt's own rule is enforced mechanically.
 *
 * @param verdict - Parsed verdict / 解析済み判定
 * @param reasons - Parsed reasons / 解析済み理由
 * @returns True when the fail should be treated as pass / pass 扱いなら true
 */
export function isNonVerdictOnlyFail(verdict: ReviewVerdict, reasons: string[]): boolean {
  if (verdict !== 'fail' || reasons.length === 0) return false;
  return reasons.every((r) => NON_VERDICT_REASON_RE.test(r));
}

/**
 * Parse the judge's reply into a verdict. Tolerant of code fences / prose around
 * the JSON. Pure and unit-testable. Unknown shape → 'unknown' (fail-open).
 *
 * @param text - The judge's raw reply. / ジャッジの応答
 * @returns Parsed verdict. / 解析結果
 */
export function parseReviewVerdict(text: string | null | undefined): DiffReviewResult {
  const fail = (verdict: ReviewVerdict, severity: number, reasons: string[]): DiffReviewResult => ({
    verdict,
    severity,
    reasons,
    judged: verdict !== 'unknown',
  });
  if (!text || !text.trim()) return fail('unknown', 0, []);

  // Extract the first balanced { ... } object.
  const start = text.indexOf('{');
  if (start === -1) return fail('unknown', 0, []);
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return fail('unknown', 0, []);

  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as {
      verdict?: string;
      severity?: number;
      reasons?: unknown;
    };
    const v = (obj.verdict || '').toLowerCase();
    let verdict: ReviewVerdict = v === 'fail' ? 'fail' : v === 'pass' ? 'pass' : 'unknown';
    const reasons = Array.isArray(obj.reasons)
      ? obj.reasons.filter((r): r is string => typeof r === 'string').slice(0, 10)
      : [];
    if (isNonVerdictOnlyFail(verdict, reasons)) verdict = 'pass';
    const severity =
      verdict === 'fail'
        ? typeof obj.severity === 'number'
          ? Math.max(0, Math.min(100, obj.severity))
          : 80
        : 0;
    return fail(verdict, severity, reasons);
  } catch {
    return fail('unknown', 0, []);
  }
}

/**
 * Aggregate independent juror verdicts into one result by majority vote.
 * Pure and unit-testable.
 *
 * Rules: only judged (non-unknown) verdicts count; more fails than passes →
 * fail, more passes → pass, TIE → fail (skeptical default — a bounced repair
 * is cheap and bounded by the repair cap, a waved-through defect is not);
 * zero judged verdicts → unknown (availability handled by the caller's risk
 * gate). Severity = max among failing jurors; reasons = deduped union.
 *
 * @param jurors - Individual verdicts. / 各ジャッジの判定
 * @returns Aggregated verdict. / 集計結果
 */
export function aggregateJuryVerdicts(jurors: JurorVerdict[]): DiffReviewResult {
  const judged = jurors.filter((j) => j.verdict !== 'unknown');
  if (judged.length === 0) {
    return { verdict: 'unknown', severity: 0, reasons: [], judged: false, jurors };
  }
  const fails = judged.filter((j) => j.verdict === 'fail');
  const passes = judged.filter((j) => j.verdict === 'pass');
  const verdict: ReviewVerdict = fails.length >= passes.length ? 'fail' : 'pass';
  if (verdict === 'pass') {
    return { verdict, severity: 0, reasons: [], judged: true, jurors };
  }
  const severity = Math.max(0, ...fails.map((j) => j.severity));
  const reasons = [...new Set(fails.flatMap((j) => j.reasons))].slice(0, 8);
  return { verdict, severity, reasons, judged: true, jurors };
}
