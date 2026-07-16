/**
 * DecisionJournal
 *
 * Records deliberate decisions (today: the plan-approval gate) with a
 * prediction, then calibrates them against the task's real terminal outcome.
 * This is the human-AI co-evolution loop: every human approval/rejection and
 * every auto-approval becomes a scored prediction, so "how accurate is the
 * human gate vs. the automation" is measurable instead of anecdotal.
 * Owns the DecisionLog model; plan-approval wiring lives in the approval
 * handler and plan-auto-approve, calibration wiring in outcome-telemetry.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('memory:decision-journal');

/** Who made a recorded decision. */
export type DecisionActor = 'user' | 'auto' | 'agent';

// NOTE: The decider is encoded into the `context` column with this stable tag
// instead of a dedicated column — adding a schema column requires a prisma
// regenerate, which only happens on a server restart (dev.js). Promote to a
// real `decidedBy` column at the next planned schema change.
const DECIDER_TAG = /\[decidedBy:(user|auto|agent)\]/;

/** Compose the context string carrying the decider tag. */
function contextFor(taskId: number, decidedBy: DecisionActor): string {
  return `タスク#${taskId} のplan承認ゲート [decidedBy:${decidedBy}]`;
}

/**
 * Extract the decider from a DecisionLog context string.
 * Pure and exported for unit tests.
 *
 * @param context - The stored context column value. / 保存済みcontext
 * @returns The decider, defaulting to 'user' for untagged rows. / 判断主体
 */
export function parseDecider(context: string | null | undefined): DecisionActor {
  const m = context?.match(DECIDER_TAG);
  return (m?.[1] as DecisionActor) ?? 'user';
}

/** Input for recording a plan-approval gate decision. */
export interface PlanDecisionInput {
  taskId: number;
  approved: boolean;
  decidedBy: DecisionActor;
  reason?: string | null;
  taskTitle?: string | null;
  themeId?: number | null;
}

/**
 * Record a plan-approval decision as a calibratable prediction.
 * Best-effort: journal writes must never block the approval flow.
 *
 * @param input - The gate decision. / 承認ゲートの判断
 * @returns The created DecisionLog id, or null on failure. / 記録ID
 */
export async function recordPlanDecision(input: PlanDecisionInput): Promise<number | null> {
  try {
    const title = input.taskTitle?.trim() || `Task #${input.taskId}`;
    const row = await prisma.decisionLog.create({
      data: {
        decision: `[plan${input.approved ? '承認' : '差し戻し'}] ${title}`,
        context: contextFor(input.taskId, input.decidedBy),
        rationale: input.reason?.trim() || null,
        predictedOutcome: input.approved
          ? 'この計画のまま実装すればタスクは完了する'
          : '差し戻しにより計画が改善され、再計画後に完了する',
        // Initial priors, not measurements — calibration replaces them with
        // real per-actor accuracy as reviewed rows accumulate.
        confidence: input.decidedBy === 'user' ? 0.75 : 0.6,
        taskId: input.taskId,
        themeId: input.themeId ?? null,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    log.warn({ err, taskId: input.taskId }, '[decision-journal] Failed to record plan decision');
    return null;
  }
}

/**
 * Calibrate the task's open plan decisions against its terminal outcome.
 *
 * Policy (documented, deliberately simple v1):
 *  - approval  + completed → correct (the approved plan delivered)
 *  - approval  + failed    → wrong   (the gate passed a plan that didn't)
 *  - rejection + completed → correct (the redo it forced ended in success)
 *  - rejection + failed    → partial (undetermined — the rejection may still
 *    have been right about the plan)
 *
 * @param taskId - Task that reached a terminal state. / 終端タスク
 * @param finalStatus - Terminal status ("completed" → success). / 終端ステータス
 * @returns Number of decisions calibrated. / 較正件数
 */
export async function calibratePlanDecisionsForTask(
  taskId: number,
  finalStatus: string,
): Promise<number> {
  try {
    const open = await prisma.decisionLog.findMany({
      where: { taskId, status: 'open' },
      select: { id: true, decision: true },
    });
    if (open.length === 0) return 0;

    const success = finalStatus === 'completed';
    const now = new Date();
    for (const d of open) {
      const wasApproval = d.decision.startsWith('[plan承認]');
      const calibration = success ? 'correct' : wasApproval ? 'wrong' : 'partial';
      await prisma.decisionLog.update({
        where: { id: d.id },
        data: {
          calibration,
          actualOutcome: `タスク終端: ${finalStatus}`,
          status: 'reviewed',
          reviewedAt: now,
        },
      });
    }
    log.info(
      { taskId, calibrated: open.length, finalStatus },
      '[decision-journal] Plan decisions calibrated against outcome',
    );
    return open.length;
  } catch (err) {
    log.warn({ err, taskId }, '[decision-journal] Calibration failed');
    return 0;
  }
}

/** Per-actor calibration aggregate. */
export interface DeciderStats {
  total: number;
  correct: number;
  wrong: number;
  partial: number;
  pending: number;
  /** correct / (correct + wrong) — partial and pending excluded. */
  precision: number | null;
}

/**
 * Aggregate calibration accuracy per decider (human vs auto) — the measurable
 * answer to "whose judgment does the plan gate need where". Aggregated in JS
 * because the decider lives in the context tag, not a column (see NOTE above).
 *
 * @returns Stats keyed by decider plus recent reviewed samples. / 較正統計
 */
export async function getDecisionCalibrationStats(): Promise<{
  byDecider: Record<string, DeciderStats>;
  recentReviewed: Array<{
    id: number;
    decision: string;
    decidedBy: DecisionActor;
    calibration: string;
    reviewedAt: Date | null;
  }>;
}> {
  const rows = await prisma.decisionLog.findMany({
    select: { context: true, calibration: true },
  });

  const byDecider: Record<string, DeciderStats> = {};
  for (const r of rows) {
    const decider = parseDecider(r.context);
    const s = (byDecider[decider] ??= {
      total: 0,
      correct: 0,
      wrong: 0,
      partial: 0,
      pending: 0,
      precision: null,
    });
    s.total += 1;
    if (r.calibration === 'correct') s.correct += 1;
    else if (r.calibration === 'wrong') s.wrong += 1;
    else if (r.calibration === 'partial') s.partial += 1;
    else s.pending += 1;
  }
  for (const s of Object.values(byDecider)) {
    const judged = s.correct + s.wrong;
    s.precision = judged > 0 ? s.correct / judged : null;
  }

  const recent = await prisma.decisionLog.findMany({
    where: { status: 'reviewed' },
    select: { id: true, decision: true, context: true, calibration: true, reviewedAt: true },
    orderBy: { reviewedAt: 'desc' },
    take: 10,
  });

  return {
    byDecider,
    recentReviewed: recent.map((r) => ({
      id: r.id,
      decision: r.decision,
      decidedBy: parseDecider(r.context),
      calibration: r.calibration,
      reviewedAt: r.reviewedAt,
    })),
  };
}
