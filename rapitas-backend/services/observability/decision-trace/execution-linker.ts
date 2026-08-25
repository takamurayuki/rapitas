/**
 * Decision Trace / Execution Linker
 *
 * Attaches a freshly created AgentExecution to the decisions that produced it.
 *
 * A routing decision is made BEFORE the execution row exists — the router picks
 * the model, then the executor creates the row — so `recordDecision` has no
 * `executionId` to write. The consistency checker joins on that column, so
 * every trace was discarded on sight: measured 2026-08-25, all 479 rows sat at
 * `skipped` with 「実行IDが未記録のため評価対象外」, and the check had run on every
 * one of them (verifiedAt was set). The decisions were recorded and never once
 * compared with what happened.
 *
 * Not responsible for judging the decision — that stays in consistency-checker.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';

const log = createLogger('decision-trace:linker');

/**
 * How far back an unlinked decision may be claimed by a new execution.
 *
 * The route is resolved immediately before dispatch, so the gap is seconds; the
 * window only has to survive a slow context build. Bounded so a decision
 * orphaned by a crashed dispatch is never mis-attributed to the next phase —
 * it stays unlinked and the checker reports it as such.
 */
const LINK_WINDOW_MS = 15 * 60 * 1000;

/**
 * Link the decisions taken for a task's current phase to its execution row.
 *
 * Claims every still-unlinked, still-unjudged decision for the task inside the
 * window — a phase can record more than one (the model route, then a provider
 * fallback). Because this runs at EVERY execution creation, a previous phase's
 * rows were already claimed at their own dispatch, so there is nothing older
 * left to steal.
 *
 * Best-effort: never throws. A failure here costs observability, not the run.
 *
 * @param taskId - Task whose phase is starting. / 実行を開始するタスクID
 * @param executionId - The execution row just created. / 生成された実行行のID
 * @returns Number of decisions linked. / 紐付けた決定の件数
 */
export async function linkPendingDecisions(
  taskId: number | null | undefined,
  executionId: number,
): Promise<number> {
  if (typeof taskId !== 'number' || !Number.isFinite(taskId)) return 0;
  try {
    const since = new Date(Date.now() - LINK_WINDOW_MS);
    const { count } = await prisma.agentDecisionTrace.updateMany({
      where: {
        taskId,
        executionId: null,
        consistency: 'pending',
        createdAt: { gte: since },
      },
      data: { executionId },
    });
    if (count > 0) {
      log.info({ taskId, executionId, count }, '[decision-trace] linked decisions to execution');
    }
    return count;
  } catch (err) {
    log.warn({ err, taskId, executionId }, '[decision-trace] link failed (non-fatal)');
    return 0;
  }
}
