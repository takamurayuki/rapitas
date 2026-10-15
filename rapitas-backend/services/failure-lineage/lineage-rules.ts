/**
 * lineage-rules
 *
 * Hand-written known failure-chain rules (stage 1 of the staged rollout).
 * A rule says "a template matching `parent` is the cause of a later template
 * matching `child`". Automatic inference is the fallback in lineage-builder.
 */

/** One known parent -> child step. */
export interface LineageRule {
  id: string;
  label: string;
  parent: RegExp;
  child: RegExp;
}

const CONFLICT = /merge conflict|\bCONFLICT\b|conflicts? (?:in|with|detected)|競合/i;
const PUSH_REJECTED =
  /push(?:ed)? (?:was )?(?:rejected|failed)|\[rejected\]|non-fast-forward|failed to push|プッシュ.*(?:拒否|失敗)/i;
const RETRY_STOPPED =
  /retr(?:y|ies)[^.]*(?:exhausted|stopped|giving up|limit|max)|(?:exhausted|max(?:imum)?)[^.]*retr(?:y|ies)|gave up|再試行.*(?:停止|上限)/i;
const CI_FAILED = /\bCI\b[^.]*(?:failed|failure)|checks? failed|CI.*失敗/i;
const REPAIR_EXHAUSTED = /(?:repair|fix)[^.]*(?:exhausted|limit|max)|修復.*上限/i;

/** Known chains: branch conflict -> push rejected -> retry stopped, CI failed -> repair exhausted. */
export const LINEAGE_RULES: readonly LineageRule[] = [
  {
    id: 'conflict_to_push_rejected',
    label: 'ブランチ競合 → push 拒否',
    parent: CONFLICT,
    child: PUSH_REJECTED,
  },
  {
    id: 'push_rejected_to_retry_stopped',
    label: 'push 拒否 → 再試行停止',
    parent: PUSH_REJECTED,
    child: RETRY_STOPPED,
  },
  {
    id: 'ci_failed_to_repair_exhausted',
    label: 'CI 失敗 → 修復上限到達',
    parent: CI_FAILED,
    child: REPAIR_EXHAUSTED,
  },
];

/**
 * Finds the first rule that links the two templates.
 *
 * @param parentTemplate - Candidate parent template / 親候補テンプレート
 * @param childTemplate - Child template / 子テンプレート
 * @returns Matching rule, or undefined / 一致したルール
 */
export function matchRule(parentTemplate: string, childTemplate: string): LineageRule | undefined {
  return LINEAGE_RULES.find((r) => r.parent.test(parentTemplate) && r.child.test(childTemplate));
}
