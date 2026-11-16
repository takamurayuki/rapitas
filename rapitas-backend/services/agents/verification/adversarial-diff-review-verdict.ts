/**
 * adversarial-diff-review-verdict
 *
 * Verdict types, the parser for one juror's reply, and the majority-vote
 * aggregation across jurors. Pure; the jury orchestration (providers, timeouts,
 * diff assembly) lives in adversarial-diff-review.ts.
 */
import type { AIProvider } from '../../../utils/ai-client/types';
import { NON_VERDICT_REASON_RE } from './adversarial-diff-review-prompt';
import type { BaseSatisfiedFinding } from './base-satisfied-plan-items';

import type { UnknownReason } from './juror-unknown-reason';
import type { AwaitingHuman, DisputeSummary, SeatRecord } from './jury-seat-types';
import {
  parseFindings,
  findingsExceedLimit,
  capFindingsForStorage,
  formatFindingReason,
  findingSeverityScore,
  type ReviewFinding,
} from './review-findings';

export type { ReviewFinding, FindingSeverity } from './review-findings';

export type ReviewVerdict = 'pass' | 'fail' | 'unknown';

/**
 * The panel-level outcome. `hold` = the review cannot settle it and a human
 * must decide (review hold); jurors themselves never answer `hold`.
 */
export type PanelVerdict = ReviewVerdict | 'hold';

/** One juror's independent verdict (provider = model family). */
export interface JurorVerdict {
  provider: AIProvider;
  /** The exact model asked — the panel can seat several of one provider. */
  model?: string;
  verdict: ReviewVerdict;
  severity: number;
  reasons: string[];
  /**
   * Why this juror did not judge. Only set when `verdict` is 'unknown'.
   *
   * Four different failures used to land on the same value, so a slide in
   * the unknown rate could not be attributed to any of them afterwards
   * (measured 2026-10-24). See juror-unknown-reason.ts.
   */
  unknownReason?: UnknownReason;
  /** Structured findings this juror reported (pass or fail). */
  findings?: ReviewFinding[];
  /** What this one call cost, when the provider reported it. */
  usage?: JurorUsage;
}

/** Spend of one juror call (subscription CLI reports these in its JSON). */
export interface JurorUsage {
  costUsd?: number;
  tokensUsed: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  /** Model the provider says actually answered. */
  modelName?: string;
  startedAt: Date;
  durationMs: number;
}

export interface DiffReviewResult {
  /**
   * 'fail' = the diff does NOT satisfy the task; 'unknown' = jury unavailable
   * (low risk, proceed); 'hold' = park for a human decision (see awaitingHuman).
   * NOTE: A caller that only checks `=== 'fail'` would wave a 'hold' through —
   * both production gates handle it explicitly.
   */
  verdict: PanelVerdict;
  /** 0-100; higher = more serious. Only meaningful for 'fail'. */
  severity: number;
  /** Short human-readable reasons (used as self-repair feedback). */
  reasons: string[];
  /** Why no verdict was reached. Only set when `verdict` is 'unknown'. */
  unknownReason?: UnknownReason;
  /** True when at least one juror actually evaluated the diff. */
  judged: boolean;
  /** Individual juror verdicts — recorded for future reliability weighting. */
  jurors?: JurorVerdict[];
  /** Fail reasons dropped because the item already exists on the base ref. */
  baseSatisfied?: BaseSatisfiedFinding[];
  /**
   * Every structured finding across the panel, kept on PASS too so minor
   * findings are recorded instead of discarded. Each carries its juror.
   */
  findings?: ReviewFinding[];
  /**
   * Fingerprint of the exact diff the jury reviewed (review-diff-fingerprint).
   * Lets a later gate tell whether this verdict is about the CURRENT diff.
   */
  diffFingerprint?: string | null;
  /** 'two_seat' for the two-reviewer form; absent on older recorded reviews. */
  form?: 'two_seat';
  /** Every seat by role (reviewer-1, reviewer-2, and the verifier when asked). */
  seats?: SeatRecord[];
  /** The verifier step, when the reviewers disagreed. */
  dispute?: DisputeSummary;
  /** Present exactly when verdict is 'hold'. */
  awaitingHuman?: AwaitingHuman;
  /** The evidence-based risk decision, recorded when the jury was undecided. */
  unavailableRisk?: { high: boolean; reason: string; source: string; files?: string[] };
}

/** One juror's parsed reply: a juror never answers 'hold'. */
export type ParsedJurorReply = Omit<DiffReviewResult, 'verdict'> & { verdict: ReviewVerdict };

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
export function parseReviewVerdict(text: string | null | undefined): ParsedJurorReply {
  const fail = (verdict: ReviewVerdict, severity: number, reasons: string[]): ParsedJurorReply => ({
    verdict,
    severity,
    reasons,
    judged: verdict !== 'unknown',
    ...(verdict === 'unknown' ? { unknownReason: 'unparsable' as const } : {}),
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
      findings?: unknown;
    };
    const v = (obj.verdict || '').toLowerCase();
    let verdict: ReviewVerdict = v === 'fail' ? 'fail' : v === 'pass' ? 'pass' : 'unknown';
    let reasons = Array.isArray(obj.reasons)
      ? obj.reasons.filter((r): r is string => typeof r === 'string').slice(0, 10)
      : [];
    // An over-limit list cannot be judged in full; partial judging could drop
    // the deciding blocker, so the reply counts as unreadable, not as a vote.
    if (findingsExceedLimit(obj.findings)) return fail('unknown', 0, []);
    const findings = parseFindings(obj.findings);

    if (findings && verdict !== 'unknown') {
      // Severity gate: the verdict follows the findings, not the juror's own
      // label. Only an EVIDENCED blocker/major can fail; minor findings and
      // unevidenced ones (要確認) are recorded but never bounce the work.
      const gating = findings.filter((f) => f.gating);
      verdict = gating.length > 0 ? 'fail' : 'pass';
      const severity =
        verdict === 'fail'
          ? typeof obj.severity === 'number'
            ? Math.max(0, Math.min(100, obj.severity))
            : Math.max(...gating.map((f) => findingSeverityScore(f.severity)))
          : 0;
      // On fail only the gating findings become repair feedback, so the
      // implementer is not sent chasing minor notes.
      reasons = (verdict === 'fail' ? gating : findings).map(formatFindingReason);
      // The verdict above saw every finding; only what is kept is bounded.
      return { ...fail(verdict, severity, reasons), findings: capFindingsForStorage(findings) };
    }

    if (isNonVerdictOnlyFail(verdict, reasons)) verdict = 'pass';
    if (verdict === 'fail') {
      // A fail in the old reasons-only shape carries no evidence to gate on.
      // Treat it as an unreadable reply rather than a vote: the caller's risk
      // gate then decides (low risk proceeds, high risk fails closed).
      return fail('unknown', 0, reasons);
    }
    return fail(verdict, 0, reasons);
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
 * The severity gate is applied per juror BEFORE this vote (parseReviewVerdict):
 * a "fail vote" already means "this juror cited an evidenced blocker/major".
 * The majority / tie→fail rules are unchanged on top of that, so a tie can
 * only fail when half the answering panel independently evidenced a serious
 * defect — not on minor or ungrounded notes.
 *
 * @param jurors - Individual verdicts. / 各ジャッジの判定
 * @returns Aggregated verdict. / 集計結果
 */
export function aggregateJuryVerdicts(jurors: JurorVerdict[]): DiffReviewResult {
  // Findings from every juror, pass or fail — recorded even when they do not
  // decide the vote (minor → 記録のみで完了).
  const findings = jurors.flatMap((j) =>
    (j.findings ?? []).map((f) => ({ ...f, juror: j.model ?? j.provider })),
  );
  const judged = jurors.filter((j) => j.verdict !== 'unknown');
  if (judged.length === 0) {
    return { verdict: 'unknown', severity: 0, reasons: [], judged: false, jurors, findings };
  }
  const fails = judged.filter((j) => j.verdict === 'fail');
  const passes = judged.filter((j) => j.verdict === 'pass');
  const verdict: ReviewVerdict = fails.length >= passes.length ? 'fail' : 'pass';
  if (verdict === 'pass') {
    return { verdict, severity: 0, reasons: [], judged: true, jurors, findings };
  }
  const severity = Math.max(0, ...fails.map((j) => j.severity));
  const reasons = [...new Set(fails.flatMap((j) => j.reasons))].slice(0, 8);
  return { verdict, severity, reasons, judged: true, jurors, findings };
}
