/**
 * repair-risk-effectiveness
 *
 * Measures whether repair-risk tactic injection pays off: compares tasks that
 * got a high-risk prediction (fired) with comparable tasks that did not, on
 * bounce rate and MTTR. Read-only and recomputed per request — nothing is
 * persisted. Does not decide anything; thresholds are tuned by a human.
 *
 * MTTR here: time from a bounce (a ROLE_TROUBLE_CAUSES transition) to the next
 * non-bounce transition of the same task, averaged per task. A bounce with no
 * later recovery row is censored (excluded), never counted as 0 minutes.
 */
import { prisma } from '../../config/database';
import {
  COMPLEXITY_LOW_MAX,
  REPAIR_RISK_PREDICTION_ACTION,
  repairRiskMinSamples,
} from '../workflow/learning/repair-risk-constants';
import { allTroubleCauses } from '../workflow/learning/repair-risk-model';

const DAY_MS = 24 * 60 * 60 * 1000;

/** One cohort's outcome. */
export interface CohortStats {
  sampleSize: number;
  lowSample: boolean;
  repairRate: number;
  /** Mean of per-task MTTRs over tasks with a resolved bounce; null when none. */
  mttrMinutes: number | null;
  mttrSampleSize: number;
}

export interface RepairRiskEffectiveness {
  windowDays: number;
  fired: CohortStats;
  notFired: CohortStats;
  /** fired − notFired; negative means the fired cohort did better. */
  delta: { repairRateDelta: number; mttrMinutesDelta: number | null };
}

interface TransitionRow {
  taskId: number;
  cause: string;
  createdAt: Date;
}

/**
 * Mean recovery time of one task's bounces.
 *
 * @param rows - One task's transitions (any order). / 1タスクの遷移
 * @param trouble - Bounce causes. / 差し戻し原因集合
 * @returns Mean minutes over resolved bursts, or null when none resolved. / 平均復旧分
 */
export function taskMttrMinutes(rows: TransitionRow[], trouble: Set<string>): number | null {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const durations: number[] = [];
  let openedAt: number | null = null;
  for (const r of sorted) {
    const t = r.createdAt.getTime();
    if (trouble.has(r.cause)) {
      // Consecutive bounces are one burst — recovery is measured from the first.
      if (openedAt === null) openedAt = t;
    } else if (openedAt !== null) {
      durations.push((t - openedAt) / 60000);
      openedAt = null;
    }
  }
  if (durations.length === 0) return null;
  return durations.reduce((a, b) => a + b, 0) / durations.length;
}

/**
 * Summarise a cohort.
 *
 * @param taskIds - Cohort members. / コホートのタスクID
 * @param byTask - Transitions grouped by task. / タスク別遷移
 * @param trouble - Bounce causes. / 差し戻し原因集合
 * @param minSamples - Sample floor for `lowSample`. / 最小サンプル数
 * @returns Cohort stats. / コホート統計
 */
export function summarizeCohort(
  taskIds: number[],
  byTask: Map<number, TransitionRow[]>,
  trouble: Set<string>,
  minSamples: number,
): CohortStats {
  let bounced = 0;
  const mttrs: number[] = [];
  for (const id of taskIds) {
    const rows = byTask.get(id) ?? [];
    if (rows.some((r) => trouble.has(r.cause))) bounced += 1;
    const m = taskMttrMinutes(rows, trouble);
    if (m !== null) mttrs.push(m);
  }
  const n = taskIds.length;
  return {
    sampleSize: n,
    lowSample: n < minSamples,
    repairRate: n > 0 ? bounced / n : 0,
    mttrMinutes: mttrs.length > 0 ? mttrs.reduce((a, b) => a + b, 0) / mttrs.length : null,
    mttrSampleSize: mttrs.length,
  };
}

/**
 * Split tasks into fired / not-fired cohorts and compare them.
 * NOTE: not-fired mixes `low` and `indeterminate` tasks — the snapshot is only
 * written for `high`, a known limitation accepted in the plan.
 *
 * @param input - Transitions, fired ids and complexity per task. / 集計入力
 * @param minSamples - Sample floor for `lowSample`. / 最小サンプル数
 * @param windowDays - Echoed window. / 集計日数
 * @returns Comparison. / 比較結果
 */
export function compareCohorts(
  input: {
    transitions: TransitionRow[];
    firedTaskIds: Set<number>;
    complexityByTask: Map<number, number | null>;
  },
  minSamples: number,
  windowDays: number,
): RepairRiskEffectiveness {
  const trouble = allTroubleCauses();
  const byTask = new Map<number, TransitionRow[]>();
  for (const r of input.transitions) {
    const list = byTask.get(r.taskId) ?? [];
    list.push(r);
    byTask.set(r.taskId, list);
  }
  const fired: number[] = [];
  const notFired: number[] = [];
  for (const id of byTask.keys()) {
    if (input.firedTaskIds.has(id)) {
      fired.push(id);
      continue;
    }
    // Only tasks that could have been judged high-risk (mid/high complexity).
    const score = input.complexityByTask.get(id);
    if (typeof score === 'number' && score > COMPLEXITY_LOW_MAX) notFired.push(id);
  }
  const f = summarizeCohort(fired, byTask, trouble, minSamples);
  const nf = summarizeCohort(notFired, byTask, trouble, minSamples);
  return {
    windowDays,
    fired: f,
    notFired: nf,
    delta: {
      repairRateDelta: f.repairRate - nf.repairRate,
      mttrMinutesDelta:
        f.mttrMinutes !== null && nf.mttrMinutes !== null ? f.mttrMinutes - nf.mttrMinutes : null,
    },
  };
}

/**
 * Compute the fired vs not-fired comparison over a trailing window.
 *
 * @param windowDays - Window length in days. / 集計日数
 * @returns Comparison. / 比較結果
 */
export async function computeRepairRiskEffectiveness(
  windowDays: number,
): Promise<RepairRiskEffectiveness> {
  const since = new Date(Date.now() - windowDays * DAY_MS);
  const [transitions, predictions] = await Promise.all([
    prisma.workflowTransition.findMany({
      where: { createdAt: { gte: since } },
      select: { taskId: true, cause: true, createdAt: true },
    }),
    prisma.activityLog.findMany({
      where: { action: REPAIR_RISK_PREDICTION_ACTION, createdAt: { gte: since } },
      select: { taskId: true },
    }),
  ]);
  const firedTaskIds = new Set<number>();
  for (const p of predictions) if (p.taskId !== null) firedTaskIds.add(p.taskId);
  const taskIds = [...new Set(transitions.map((t) => t.taskId))];
  const tasks =
    taskIds.length > 0
      ? await prisma.task.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, complexityScore: true },
        })
      : [];
  const complexityByTask = new Map<number, number | null>(
    tasks.map((t) => [t.id, t.complexityScore ?? null]),
  );
  return compareCohorts(
    { transitions, firedTaskIds, complexityByTask },
    repairRiskMinSamples(),
    windowDays,
  );
}
