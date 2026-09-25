/**
 * Phase Split Planner
 *
 * Pure decision logic for whether an assembled role context (see
 * workflow-context-metrics.ts) is predicted to exceed the CLI token ceiling,
 * and if so, how to split it into sequential sub-phases along its existing
 * semantic section boundaries. Does not execute, persist, or display
 * anything — callers decide what to do with the returned plan.
 */
import type { ContextMetrics, SectionMetric } from './workflow-context-metrics';

/**
 * Token ceiling used to decide whether a phase-split proposal is warranted.
 *
 * This is a task-level planning threshold, distinct from
 * `DEFAULT_MAX_PROMPT_TOKENS` (150,000) in `prompt-size-guard.ts`, which is a
 * CLI request safety margin applied *after* assembly to avoid the 200,000
 * hard limit. This constant instead marks the point, at *planning* time,
 * where splitting the work itself (not just trimming the prompt) becomes the
 * better strategy.
 */
export const DEFAULT_PHASE_SPLIT_TOKEN_LIMIT = 200_000;

/** One proposed sub-phase: a contiguous run of sections executed together. */
export interface PhaseSplitPlan {
  /** 1-based position of this phase in execution order. / 実行順序（1始まり） */
  index: number;
  /** Section names assigned to this phase, in original order. / 割当セクション名 */
  sectionNames: string[];
  /** Sum of estimated tokens of the sections in this phase. / フェーズ内推定トークン合計 */
  estTokens: number;
}

/** Result of evaluating a context against the phase-split token limit. */
export interface PhaseSplitResult {
  /** True when totalEstTokens exceeds limitTokens. / 超過見込みか */
  exceedsLimit: boolean;
  /** Total estimated tokens across all sections. / 全セクション推定トークン合計 */
  totalEstTokens: number;
  /** Token ceiling this result was evaluated against. / 判定に用いた上限値 */
  limitTokens: number;
  /**
   * Proposed sub-phases in execution order. Non-empty sections only ever
   * produce a single phase when not exceeding the limit (no split needed);
   * an empty `sections` input produces an empty array.
   */
  phases: PhaseSplitPlan[];
}

/**
 * Decide whether a context is predicted to exceed the phase-split token
 * limit and, if so, propose a split along its existing section boundaries.
 *
 * Splitting uses a greedy bin-packing pass over `metrics.sections` in their
 * given order (their order already reflects the semantic/logical grouping
 * assigned by the context builder — see computeSectionMetrics): sections are
 * appended to the current phase until the next section would push it over
 * `limitTokens`, at which point a new phase starts. A single section whose
 * own estTokens already exceeds `limitTokens` is kept alone in its own
 * phase rather than rejected — this function only groups existing sections,
 * it never subdivides one.
 *
 * @param metrics - Section-level metrics from computeSectionMetrics. / セクション計測結果
 * @param limitTokens - Token ceiling to evaluate against. / 判定に用いる上限値
 * @returns Overflow verdict and proposed phase list. / 超過判定と分割案
 */
export function planPhaseSplit(
  metrics: ContextMetrics,
  limitTokens: number = DEFAULT_PHASE_SPLIT_TOKEN_LIMIT,
): PhaseSplitResult {
  const { sections, totalEstTokens } = metrics;
  const exceedsLimit = totalEstTokens > limitTokens;

  if (sections.length === 0) {
    return { exceedsLimit, totalEstTokens, limitTokens, phases: [] };
  }

  if (!exceedsLimit) {
    return {
      exceedsLimit,
      totalEstTokens,
      limitTokens,
      phases: [
        {
          index: 1,
          sectionNames: sections.map((s) => s.name),
          estTokens: totalEstTokens,
        },
      ],
    };
  }

  const phases: PhaseSplitPlan[] = [];
  let current: SectionMetric[] = [];
  let currentTokens = 0;

  for (const section of sections) {
    const wouldExceed = current.length > 0 && currentTokens + section.estTokens > limitTokens;
    if (wouldExceed) {
      phases.push(toPhasePlan(phases.length + 1, current, currentTokens));
      current = [];
      currentTokens = 0;
    }
    current.push(section);
    currentTokens += section.estTokens;
  }
  if (current.length > 0) {
    phases.push(toPhasePlan(phases.length + 1, current, currentTokens));
  }

  return { exceedsLimit, totalEstTokens, limitTokens, phases };
}

function toPhasePlan(index: number, sections: SectionMetric[], estTokens: number): PhaseSplitPlan {
  return { index, sectionNames: sections.map((s) => s.name), estTokens };
}
