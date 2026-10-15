/**
 * KnowledgeReuseEvaluator
 *
 * Producer for `supervision_knowledge_reuse_eval` — the comparison
 * knowledge-reuse-comparison.ts reads but nothing ever wrote. Compares the
 * qualified-landing rate (task-landing-evidence.ts's own "success" bar) for
 * tasks whose planner context carried a CBR case (context_section_metrics,
 * key 'case' — the nearest SOLVED similar task's plan-that-worked) against
 * tasks whose planner context did not.
 *
 * 'case' was chosen over the more general 'memory' section after checking the
 * actual data (2026-09-17): 'memory' (design-decision/lesson recall) and
 * 'lessons' were present in 130/130 sampled planner contexts — the system's
 * memory recall is broad enough that it never naturally produces a "without"
 * group, making a presence/absence comparison on it structurally impossible
 * to observe. 'case' (the CBR nearest-case retrieval) varied (24/130) and is
 * also a more precise operationalization of "knowledge reuse" — a specific
 * prior solution actually being reused, not just background context.
 *
 * Deliberately observational, not a randomized trial: whether a task's
 * planner surfaces a matching case is not assigned at random, so a real
 * confound (tasks that surface a case may differ systematically from ones
 * that don't — by theme, complexity, or how novel the work is) cannot be
 * ruled out. This is the best signal available without building a dedicated
 * on/off trial (the kind task 894 built for prompt evolution);
 * sufficientEvidence stays conservative (a real minimum per-group N)
 * precisely because of that limitation, not as a formality.
 *
 * Not responsible for judging sufficiency (see knowledge-reuse-comparison.ts,
 * which this module writes through) or scheduling (backlog-scheduler.ts).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { gatherTaskLandingEvidence } from './task-landing-evidence';
import { recordKnowledgeReuseEval } from './knowledge-reuse-comparison';

const log = createLogger('supervision:knowledge-reuse-evaluator');

/** Bump when the comparison's outcome/treatment definitions change. */
export const EVAL_SET_VERSION = 'landing-qualified-vs-planner-case-v1';
/** Bump when the statistical method itself changes. */
export const METHOD_VERSION = 'two-proportion-wald-ci-v1';
/** Per-group minimum before the normal approximation (and the comparison's
 * honesty) is trusted — below this the verdict stays "insufficient". */
const MIN_GROUP_N = 10;
/** z for a 95% two-sided interval. */
const Z_95 = 1.959963985;
/** Evidence window: long enough to accumulate both groups, short enough to
 * track the current planner/memory pipeline rather than stale history. */
const DEFAULT_LOOKBACK_DAYS = 45;

export interface TaskOutcome {
  taskId: number;
  /** true only for a confirmed qualified landing (task-landing-classifier.ts). */
  success: boolean;
  /** True when retained despite an unresolved landing (pending/unobservable)
   * rather than a confirmed qualified/failed verdict — intention-to-treat:
   * kept in the denominator as a non-success instead of dropped, so a
   * comparison cannot look better than reality by excluding the undecided. */
  uncertain: boolean;
}

export interface ComparisonResult {
  pairedN: number;
  missingRetainedN: number;
  successRateWithKB: number | null;
  successRateWithoutKB: number | null;
  effectSize: number | null;
  intervalOrPValue: string | null;
  sufficientEvidence: boolean;
}

/**
 * Combines outcome and treatment (CBR case-present) evidence into the
 * two-proportion comparison. Pure — the testable core.
 *
 * @param outcomes - One entry per task with a determined outcome. / 結果が判明したタスク一覧
 * @param treatments - taskId → whether the planner context carried a CBR case. / タスクID→類似ケース注入有無
 * @returns The comparison, honest about insufficiency. / 比較結果
 */
export function computeKnowledgeReuseComparison(
  outcomes: TaskOutcome[],
  treatments: Map<number, boolean>,
): ComparisonResult {
  let successA = 0;
  let nA = 0;
  let successB = 0;
  let nB = 0;
  let missingRetainedN = 0;
  for (const o of outcomes) {
    const hadCase = treatments.get(o.taskId);
    if (hadCase === undefined) continue; // treatment unknown — cannot classify, excluded
    if (o.uncertain) missingRetainedN += 1;
    if (hadCase) {
      nA += 1;
      if (o.success) successA += 1;
    } else {
      nB += 1;
      if (o.success) successB += 1;
    }
  }
  const pairedN = nA + nB;
  const rateA = nA > 0 ? successA / nA : null;
  const rateB = nB > 0 ? successB / nB : null;
  if (nA === 0 || nB === 0) {
    return {
      pairedN,
      missingRetainedN,
      successRateWithKB: rateA,
      successRateWithoutKB: rateB,
      effectSize: null,
      intervalOrPValue: null,
      sufficientEvidence: false,
    };
  }
  const pA = successA / nA;
  const pB = successB / nB;
  const diff = pA - pB;
  const se = Math.sqrt((pA * (1 - pA)) / nA + (pB * (1 - pB)) / nB);
  const margin = Z_95 * se;
  return {
    pairedN,
    missingRetainedN,
    successRateWithKB: Math.round(pA * 1000) / 1000,
    successRateWithoutKB: Math.round(pB * 1000) / 1000,
    effectSize: Math.round(diff * 1000) / 1000,
    intervalOrPValue: `95% Wald CI for risk difference: [${(diff - margin).toFixed(3)}, ${(diff + margin).toFixed(3)}] (n=${nA} with / ${nB} without)`,
    sufficientEvidence: nA >= MIN_GROUP_N && nB >= MIN_GROUP_N,
  };
}

/** One row of context_section_metrics as read back for treatment classification. */
interface ContextMetricsRow {
  taskId?: unknown;
  role?: unknown;
  sections?: unknown;
}

/** Whether a parsed context_section_metrics payload shows a non-empty 'case' section (a CBR nearest-case hit). */
function payloadHadCase(parsed: ContextMetricsRow): boolean {
  const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
  return sections.some(
    (s): s is { name: string; chars: number } =>
      !!s &&
      typeof s === 'object' &&
      (s as { name?: unknown }).name === 'case' &&
      typeof (s as { chars?: unknown }).chars === 'number' &&
      (s as { chars: number }).chars > 0,
  );
}

/**
 * Gathers this evaluation's two inputs from the DB: task outcomes
 * (task-landing-evidence.ts, the same "success" bar the streak uses) and
 * per-task treatment (earliest planner context_section_metrics in the
 * window — later re-plans/repairs don't change what the FIRST plan saw).
 *
 * @param lookbackStart - Evidence window start. / 集計開始時刻
 * @returns Outcomes and the treatment map. / 結果と処置の対応
 */
export async function gatherKnowledgeReuseEvidence(
  lookbackStart: Date,
): Promise<{ outcomes: TaskOutcome[]; treatments: Map<number, boolean> }> {
  const landing = await gatherTaskLandingEvidence(lookbackStart);
  const outcomeByTask = new Map<number, TaskOutcome>();
  for (const l of landing.landings) {
    outcomeByTask.set(l.taskId, {
      taskId: l.taskId,
      success: l.landingClass === 'qualified',
      uncertain: l.landingClass === 'landing_pending' || l.landingClass === 'policy_unreadable',
    });
  }
  for (const f of landing.failures) {
    if (f.taskId == null || outcomeByTask.has(f.taskId)) continue;
    outcomeByTask.set(f.taskId, { taskId: f.taskId, success: false, uncertain: false });
  }
  const outcomes = [...outcomeByTask.values()];

  const treatments = new Map<number, boolean>();
  if (outcomes.length > 0) {
    const taskIds = new Set(outcomes.map((o) => o.taskId));
    const rows = await prisma.timelineEvent.findMany({
      where: { eventType: 'context_section_metrics', createdAt: { gte: lookbackStart } },
      select: { payload: true },
      orderBy: { createdAt: 'asc' },
      take: 20_000,
    });
    for (const row of rows) {
      let parsed: ContextMetricsRow;
      try {
        parsed = JSON.parse(row.payload) as ContextMetricsRow;
      } catch {
        continue;
      }
      if (parsed.role !== 'planner') continue;
      const taskId = typeof parsed.taskId === 'number' ? parsed.taskId : null;
      if (taskId == null || !taskIds.has(taskId) || treatments.has(taskId)) continue;
      treatments.set(taskId, payloadHadCase(parsed));
    }
  }
  return { outcomes, treatments };
}

/**
 * Runs one evaluation pass and records it via recordKnowledgeReuseEval.
 * Fail-open — a broken pass is logged and yields 0, never throws.
 *
 * @param opts.lookbackDays - Evidence window (default 45). / 遡り日数
 * @param opts.now - Anchor time (injectable for tests). / 基準時刻
 * @returns 1 when a comparison was recorded, else 0. / 記録できたら1
 */
export async function evaluateAndRecordKnowledgeReuse(
  opts: { lookbackDays?: number; now?: Date } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const lookbackStart = new Date(
    now.getTime() - (opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * 24 * 60 * 60 * 1000,
  );
  try {
    const { outcomes, treatments } = await gatherKnowledgeReuseEvidence(lookbackStart);
    const result = computeKnowledgeReuseComparison(outcomes, treatments);
    await recordKnowledgeReuseEval({
      evalSetVersion: EVAL_SET_VERSION,
      methodVersion: METHOD_VERSION,
      ...result,
    });
    log.info({ ...result }, '[knowledge-reuse-evaluator] comparison recorded');
    return 1;
  } catch (err) {
    log.warn({ err }, '[knowledge-reuse-evaluator] evaluation failed');
    return 0;
  }
}
