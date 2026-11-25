/**
 * follow-up-findings
 *
 * Moves decisive findings whose impact is follow_up out of a failing review
 * and into the concern backlog, so a low-impact defect (an estimate, a
 * classification, a heuristic's accuracy) no longer stops completion. Not
 * responsible for judging findings (review-findings.ts) or the seat vote
 * (two-seat-review.ts): impact never changes a seat's vote, so a seat split on
 * impact is an agreed fail with the blocking copy still gating.
 *
 * NOTE: Task 1541 (2026-11-25) was bounced eight times; each round its
 * negation miss stopped completion as [major] although a misclassification
 * only adds or drops one weekly concern. This is the one place that relaxes
 * the verdict; its rules are fixed in plan.md of task 1547.
 */
import type { DiffReviewResult } from './adversarial-diff-review-verdict';
import { fileFindingsAsConcerns } from './out-of-criteria-findings';
import { formatFindingReason, type ReviewFinding } from './review-findings';

/**
 * Whether a finding decides the verdict: gating, and not discarded by the
 * verifier seat (only `holds` or an undisputed finding fails a review).
 *
 * @param f - Finding / 指摘
 * @returns True when it is a decisive finding / 決め手の指摘なら true
 */
export function isDecisiveFinding(f: ReviewFinding): boolean {
  return f.gating && f.verification !== 'refuted' && f.verification !== 'undetermined';
}

const findingKey = (f: ReviewFinding) => `${f.criterion}\u0000${f.summary}`;

function isFollowUp(f: ReviewFinding): boolean {
  return isDecisiveFinding(f) && f.impact === 'follow_up' && f.severity !== 'blocker';
}

/**
 * Take the follow_up findings out of a failing review. The fail becomes a pass
 * only when no other decisive finding and no other reason remains.
 *
 * @param result - Panel result after the other filters / 他の後処理を済ませた判定
 * @returns The adjusted result and the findings moved out / 調整後の判定と外した指摘
 */
export function splitFollowUp(result: DiffReviewResult): {
  result: DiffReviewResult;
  followUp: ReviewFinding[];
} {
  // hold is a human's call and unknown was never judged: neither is relaxed.
  if (result.verdict !== 'fail') return { result, followUp: [] };
  const all = result.findings ?? [];
  // NOTE: A gating finding the verifier could not decide is an open dispute a
  // human must settle (settleDispute → hold). Relaxing around it would pass the
  // work with that dispute unseen, so the panel's fail stands unchanged (R1).
  if (all.some((f) => f.gating && f.verification === 'undetermined' && !isFollowUp(f))) {
    return { result, followUp: [] };
  }
  const followUp = all.filter(isFollowUp);
  if (followUp.length === 0) return { result, followUp };
  const remaining = all.filter((f) => isDecisiveFinding(f) && !followUp.includes(f));
  // A blocking finding with the same reason text keeps that reason.
  const kept = new Set(remaining.map(formatFindingReason));
  const movedReasons = [...new Set(followUp.map(formatFindingReason))];
  const moved = new Set(movedReasons.filter((r) => !kept.has(r)));
  const reasons = result.reasons.filter((r) => !moved.has(r));
  const findings = all.map((f) =>
    followUp.includes(f) ? { ...f, gating: false, deferred: 'follow_up' as const } : f,
  );
  const passes = remaining.length === 0 && reasons.length === 0;
  // Counted per distinct finding: both seats usually report the same one.
  const count = new Set(followUp.map(findingKey)).size;
  const record = { count, reasons: movedReasons, verdictChanged: passes };
  if (passes) {
    return {
      result: { ...result, verdict: 'pass', severity: 0, reasons, findings, followUp: record },
      followUp,
    };
  }
  return { result: { ...result, reasons, findings, followUp: record }, followUp };
}

const kindOf = (f: ReviewFinding) => f.kind ?? 'other';

/**
 * File follow_up findings as concerns. A finding with the same criterion and
 * kind as a still-blocking one is skipped: the implementer is already fixing
 * that kind in this bounce.
 *
 * @param findings - Findings moved out by splitFollowUp / 後続に回した指摘
 * @param ctx - Task and theme / タスクとテーマ
 * @param remainingBlocking - Decisive findings still failing the review / 残った決め手の指摘
 */
export async function fileFollowUpFindings(
  findings: ReviewFinding[],
  ctx: { taskId: number; themeId: number | null },
  remainingBlocking: ReviewFinding[],
): Promise<void> {
  const blockingKeys = new Set(remainingBlocking.map((f) => `${f.criterion}\u0000${kindOf(f)}`));
  const toFile = findings.filter((f) => !blockingKeys.has(`${f.criterion}\u0000${kindOf(f)}`));
  // One concern per distinct finding even when both seats reported it.
  const unique = [...new Map(toFile.map((f) => [findingKey(f), f])).values()];
  await fileFindingsAsConcerns(unique, ctx, {
    source: 'adversarial_review_follow_up',
    severity: 'medium',
    dedupKey: (f, digest) => `follow-up:${ctx.taskId}:${f.criterion ?? 'none'}:${digest}`,
    detail: (f) =>
      `タスク #${ctx.taskId} の独立レビューで見つかったが、影響が小さく後から直せる（impact=follow_up）ため、` +
      `完了を止めずに後続へ回した指摘。\n\n${formatFindingReason(f)}` +
      (f.kind ? `\n\n種類: ${f.kind}` : '') +
      (f.examples?.length
        ? `\n\n同じ種類の反例（種類全体を直し、反例の表をテストにすること）:\n${f.examples
            .map((e) => `- ${e}`)
            .join('\n')}`
        : '') +
      (f.repro ? `\n\n再現: ${f.repro}` : ''),
    label: 'follow-up',
  });
}
