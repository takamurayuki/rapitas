/**
 * jury-repair-reason
 *
 * Builds the bounce reason handed to the implementer after a failed diff
 * review: the legacy one-line headline, plus — when a decisive finding lists
 * same-kind counterexamples, or the same criterion and kind failed the two
 * previous jury bounces — an appendix that lists the examples, says to fix the
 * whole kind, and asks for a change of method. Pure; history loading lives in
 * jury-repair-history.ts.
 *
 * NOTE: Task 1541 (2026-11-25) missed negations four times in a new form each
 * round (past tense, polite form, after a machine word) because each bounce
 * named one counterexample and the implementer fixed only that one.
 */
import type { ReviewFinding } from '../agents/verification/review-findings';

/** Where the appendix starts. Detectors strip from here (stripJuryRepairAppendix). */
export const JURY_REPAIR_APPENDIX_MARKER = '\n\n【同種の反例と修正方針】';

/** How the method-review sentence starts (hasMethodReviewDirective looks for it). */
export const METHOD_REVIEW_PREFIX = '方式の見直し: ';

/** The instruction every appendix carries. */
export const FIX_WHOLE_KIND_TEXT =
  'この種類全体を直し、反例の表をテストにすること。1件だけ直すのは不可。';

const HEADLINE_PREFIX = '差分レビュー不合格: ';
const MAX_APPENDIX_CHARS = 3000;
const MAX_LISTED_FINDINGS = 5;
const NO_CRITERION = '(基準なし)';

/** The fields of a stored finding the repeat check reads. */
export type RoundFinding = Pick<
  Partial<ReviewFinding>,
  'criterion' | 'kind' | 'gating' | 'verification' | 'deferred' | 'summary'
>;

/** Findings of one earlier bounce, or null when that bounce was not a jury bounce. */
export type PriorJuryRound = RoundFinding[] | null;

/** A criterion + kind that failed three bounces in a row. */
export interface RepeatedFindingKind {
  criterion: string;
  kind: string;
}

function isDecisive(f: RoundFinding): boolean {
  return (
    f.gating === true &&
    f.deferred !== 'follow_up' &&
    f.verification !== 'refuted' &&
    f.verification !== 'undetermined'
  );
}

const criterionOf = (f: RoundFinding) => f.criterion ?? NO_CRITERION;
const kindOf = (f: RoundFinding) => f.kind ?? 'other';

// 'other' (or no kind) matches any kind: the method-review text is advice, and
// missing it costs another whack-a-mole round while adding it costs one sentence.
function sameKey(a: RoundFinding, b: RoundFinding): boolean {
  if (criterionOf(a) !== criterionOf(b)) return false;
  const ka = kindOf(a);
  const kb = kindOf(b);
  return ka === kb || ka === 'other' || kb === 'other';
}

/**
 * Whether the same criterion and kind decided this review and both previous
 * bounces. A non-jury bounce (null) in between breaks the run.
 *
 * @param current - Findings of this review / 今回の指摘
 * @param priorRounds - Earlier bounces, newest first / 過去の差し戻し（新しい順）
 * @returns The repeated key, or null / 連続した基準と種類（無ければ null）
 */
export function detectRepeatedFindingKind(
  current: ReadonlyArray<RoundFinding> | undefined,
  priorRounds: ReadonlyArray<PriorJuryRound>,
): RepeatedFindingKind | null {
  const [last, beforeLast] = priorRounds;
  if (!last || !beforeLast) return null;
  for (const f of (current ?? []).filter(isDecisive)) {
    const inLast = last.filter(isDecisive).find((p) => sameKey(f, p));
    const inBefore = beforeLast.filter(isDecisive).find((p) => sameKey(f, p));
    if (inLast && inBefore) {
      const named = [f, inLast, inBefore].map(kindOf).find((k) => k !== 'other') ?? 'other';
      return { criterion: criterionOf(f), kind: named };
    }
  }
  return null;
}

/**
 * The method-review sentence for a criterion + kind that failed three times.
 *
 * @param r - Repeated criterion and kind / 連続した基準と種類
 * @returns The sentence / 方式見直しの文
 */
export function methodReviewText(r: RepeatedFindingKind): string {
  return (
    `${METHOD_REVIEW_PREFIX}${r.criterion} で同じ種類（${r.kind}）の指摘が3回続いています。` +
    'ケースを列挙して足すのをやめ、規則で判定する方式（語彙の列挙ではなく正規化・構文の規則など）に改め、' +
    'その判断を verify.md に書くこと。'
  );
}

/**
 * Build the bounce reason for a failed diff review. Without examples and
 * without a repeat it is byte-identical to the legacy one-liner.
 *
 * @param review.reasons - Review reasons / レビューの理由
 * @param review.findings - Review findings / レビューの指摘
 * @param priorRounds - Earlier bounces, newest first / 過去の差し戻し（新しい順）
 * @returns The reason / 差し戻しの理由
 */
export function buildJuryRepairReason(
  review: { reasons: string[]; findings?: ReadonlyArray<ReviewFinding> },
  priorRounds: ReadonlyArray<PriorJuryRound>,
): string {
  const headline = `${HEADLINE_PREFIX}${
    review.reasons.slice(0, 5).join(' / ') || '受入基準を満たしていません'
  }`;
  const decisive = (review.findings ?? []).filter(isDecisive);
  const withExamples = decisive.filter((f) => (f.examples?.length ?? 0) > 0);
  const repeated = detectRepeatedFindingKind(decisive, priorRounds);
  if (withExamples.length === 0 && !repeated) return headline;

  const tail = [FIX_WHOLE_KIND_TEXT, ...(repeated ? [methodReviewText(repeated)] : [])];
  let budget = MAX_APPENDIX_CHARS - JURY_REPAIR_APPENDIX_MARKER.length - tail.join('\n').length - 1;
  const lines: string[] = [];
  const push = (line: string): boolean => {
    if (line.length + 1 > budget) return false;
    lines.push(line);
    budget -= line.length + 1;
    return true;
  };
  for (const f of withExamples.slice(0, MAX_LISTED_FINDINGS)) {
    if (!push(`- ${criterionOf(f)} [${kindOf(f)}] ${f.summary.replace(/\s+/g, ' ')}`)) break;
    for (const e of f.examples ?? []) if (!push(`  - ${e.replace(/\s+/g, ' ')}`)) break;
  }
  return `${headline}${JURY_REPAIR_APPENDIX_MARKER}\n${[...lines, ...tail].join('\n')}`;
}

/**
 * Whether a bounce reason asks for a method review. Only the appendix counts,
 * so the same words in a headline or a quoted verify.md line never match.
 * The non-convergence detectors use it to let this one reason reach the
 * implementer before they cut the loop off (R2).
 *
 * @param reason - Bounce reason / 差し戻しの理由
 * @returns True when the appendix carries the method review / 付録に方式見直しがあれば true
 */
export function hasMethodReviewDirective(reason: string): boolean {
  const at = reason.indexOf(JURY_REPAIR_APPENDIX_MARKER);
  return at >= 0 && reason.slice(at).includes(METHOD_REVIEW_PREFIX);
}

/**
 * Whether a reason earns the one-time grace from the non-convergence cutoff:
 * it is the first reason in the window to carry the method review. Later ones
 * do not, so the cutoff is delayed by at most one bounce.
 *
 * @param current - Reason about to trigger a bounce / 今回の理由
 * @param prior - Reasons of earlier bounces in the window / 過去の理由
 * @returns True when the cutoff should wait this once / 今回だけ打ち切りを待つなら true
 */
export function isFirstMethodReview(current: string, prior: ReadonlyArray<string>): boolean {
  return hasMethodReviewDirective(current) && !prior.some(hasMethodReviewDirective);
}

/**
 * Drop the appendix so detectors that read criterion numbers and quoted
 * evidence see only the headline (examples are not indictments).
 *
 * @param reason - Bounce reason / 差し戻しの理由
 * @returns The reason without its appendix / 付録を除いた理由
 */
export function stripJuryRepairAppendix(reason: string): string {
  const at = reason.indexOf(JURY_REPAIR_APPENDIX_MARKER);
  return at >= 0 ? reason.slice(0, at) : reason;
}
