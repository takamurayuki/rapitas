/**
 * jury-unavailable-risk
 *
 * Decides whether a change is high-risk when the review jury could not decide
 * (every seat unavailable, or the review itself errored), from EVIDENCE: the
 * paths the diff actually changes, then research.md's own リスク判定 and the
 * files plan.md declares (risk-evidence.ts). The keyword detector over the
 * task's prose is used only when no evidence exists at all.
 * Not responsible for what happens to a high-risk change (the review hold).
 *
 * Why: this decision used to be detectHighRisk over title + description + plan
 * alone, while routing had already moved to evidence first (task 661 measured
 * every prose-floor premium pick it inspected as a false positive). The same
 * work could be "high risk" for the jury and "low risk" for routing.
 */
import { detectHighRisk } from './risk-detection';
import { isRiskyDeclaredPath, resolveRiskFromEvidence } from './risk-evidence';

/** Where the decision came from, recorded with the review for auditing. */
export type JuryRiskSource =
  | 'diff_paths'
  | 'research_verdict'
  | 'declared_files'
  | 'evidence_clear'
  | 'keyword_fallback';

/** The risk decision for an undecided review. */
export interface JuryUnavailableRisk {
  high: boolean;
  reason: string;
  source: JuryRiskSource;
  /** Changed or declared paths that made it high, when path-based. */
  files?: string[];
}

/**
 * Resolve the risk of a change whose review could not be decided.
 *
 * @param input.changedFiles - Paths in the reviewed diff, when it was read / 差分の変更パス
 * @param input.researchContent - research.md body / research.md 本文
 * @param input.planContent - plan.md body / plan.md 本文
 * @param input.title - Task title (keyword fallback only) / タスク名
 * @param input.description - Task description (keyword fallback only) / 説明
 * @returns The decision and its source / 判定と根拠の出所
 */
export function resolveJuryUnavailableRisk(input: {
  changedFiles?: readonly string[] | null;
  researchContent?: string | null;
  planContent?: string | null;
  title?: string | null;
  description?: string | null;
}): JuryUnavailableRisk {
  const risky = (input.changedFiles ?? []).filter(isRiskyDeclaredPath);
  if (risky.length > 0) {
    return {
      high: true,
      reason: `the diff changes high-risk paths (${risky.slice(0, 3).join(', ')})`,
      source: 'diff_paths',
      files: risky,
    };
  }

  const evidence = resolveRiskFromEvidence({
    researchContent: input.researchContent,
    planContent: input.planContent,
  });
  if (evidence) {
    return {
      high: evidence.high,
      reason: evidence.reason,
      source: evidence.source,
      ...(evidence.files ? { files: evidence.files } : {}),
    };
  }

  const keyword = detectHighRisk({
    text: `${input.title ?? ''}\n${input.description ?? ''}`,
    planContent: input.planContent ?? undefined,
  });
  return {
    high: keyword.high,
    reason: keyword.reason ?? 'no evidence; keyword detector found no high-risk signal',
    source: 'keyword_fallback',
  };
}
