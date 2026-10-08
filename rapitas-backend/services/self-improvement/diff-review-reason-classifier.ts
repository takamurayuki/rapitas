/**
 * Diff Review Reason Classifier
 *
 * Deterministic keyword triage of adversarial diff-review rejection reasons
 * into scope-drift (diff contains unplanned changes) and plan-gap (planned or
 * required work is missing from the diff).
 * Not responsible for counting or windowing — see loop-metrics.ts.
 */

/** Sub-category of a verify_repair_diff_review reason. */
export type DiffReviewSubCategory = 'scope_drift' | 'plan_gap' | 'unclassified';

// NOTE: The jury emits free text (verify-adversarial-review.ts joins up to 5
// reasons with ' / '), so classification is keyword-based. Keep the lists
// specific: "計画" alone is excluded so "計画外" never reads as a plan gap.
const SCOPE_DRIFT_PATTERNS: RegExp[] = [
  /計画外/,
  /スコープ(外|逸脱|違反)/,
  /範囲外/,
  /混入/,
  /無関係/,
  /関係のない/,
  /unrelated/i,
  /out[- ]of[- ]scope/i,
  /scope[- ]creep/i,
];

const PLAN_GAP_PATTERNS: RegExp[] = [
  /未実装/,
  /未実施/,
  /未追加/,
  /未対応/,
  /含まれて(い)?ない/,
  /欠落/,
  /不足/,
  /受入基準/,
  /チェックリスト/,
  /missing/i,
  /not implemented/i,
];

function firstMatchIndex(patterns: RegExp[], text: string): number {
  let best = -1;
  for (const p of patterns) {
    const m = p.exec(text);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

/**
 * Classify a diff-review rejection reason as scope drift or plan gap. When a
 * concatenated reason mentions both, the family whose keyword appears first wins.
 *
 * @param reason - metadata.reason of a diff-review verify_repair transition. / 差分レビュー差し戻し理由
 * @returns The sub-category. / サブ分類
 */
export function classifyDiffReviewReason(reason: string | undefined | null): DiffReviewSubCategory {
  if (!reason) return 'unclassified';
  const scope = firstMatchIndex(SCOPE_DRIFT_PATTERNS, reason);
  const gap = firstMatchIndex(PLAN_GAP_PATTERNS, reason);
  if (scope === -1 && gap === -1) return 'unclassified';
  if (gap === -1) return 'scope_drift';
  if (scope === -1) return 'plan_gap';
  return scope <= gap ? 'scope_drift' : 'plan_gap';
}
