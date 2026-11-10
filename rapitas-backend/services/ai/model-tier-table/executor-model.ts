/**
 * model-tier-table/executor-model
 *
 * Finds which model implemented a task, so review roles can be held to "at
 * least the executor's tier". Reads the task's implementer EXECUTION records —
 * the model each run reported (AgentExecution.modelName) — not the route pin,
 * which is only what the router planned and does not exist at all for an
 * explicitly configured model. Not responsible for routing.
 *
 * When no implementer run reported a model — or ANY run that may have
 * contributed to the diff did not — the executor is UNVERIFIED and treated as
 * premium (seat-planner's UNVERIFIED_EXECUTOR): the reviewer floor is then
 * decided by the strongest possible executor, never by a guess.
 */
import { createLogger } from '../../../config/logger';
import { NOT_REVIEW_COST_ROW } from '../../agents/review-cost-rows';
import { executorRefOf, UNVERIFIED_EXECUTOR, type ExecutorRef } from './seat-planner';
import { tierRank } from './tier-table';

const log = createLogger('model-tier-table:executor-model');

/** Session mode of the implementer phase (workflow-cli-executor / execute-route). */
const IMPLEMENTER_SESSION_MODE = 'workflow-implementer';

/**
 * The executor of a task's implementation, from what its runs reported.
 *
 * Several implementer runs (retries, repair bounces, a mid-task provider
 * switch) may have contributed to the diff; the STRONGEST reported tier is
 * taken (newest first among equals), so a reviewer is never held only to the
 * weakest of them.
 *
 * Any lookup failure, no run at all, or ANY run without a reported model
 * yields the unverified executor (assumed premium) — the safe side for every
 * floor derived from it. A run without a model cannot be shown not to have
 * touched the diff (a repair run that crashed after editing still edited), so
 * a known Sonnet run next to it must not lower the floor to standard.
 *
 * @param taskId - Task under review / レビュー対象のタスクID
 * @returns Executor reference (unverified when unknown) / 実行役（不明なら未確認）
 */
export async function resolveExecutor(taskId: number | null | undefined): Promise<ExecutorRef> {
  if (taskId == null) return UNVERIFIED_EXECUTOR;
  try {
    // Lazy: many test files mock config/database without agentExecution, and a
    // static import would make this module fail their import.
    const { prisma } = await import('../../../config/database');
    // NOTE: No modelName filter and no row cap — both used to drop runs that
    // may have contributed (an unreported repair run, an older retry), letting
    // the remaining known runs decide a LOWER floor (G2 routing1 item 3).
    const runs = await prisma.agentExecution.findMany({
      where: {
        ...NOT_REVIEW_COST_ROW,
        session: { mode: IMPLEMENTER_SESSION_MODE, config: { taskId } },
      },
      select: { modelName: true },
      orderBy: { createdAt: 'desc' },
    });
    let best: ExecutorRef | null = null;
    for (const run of runs ?? []) {
      const ref = executorRefOf(run.modelName);
      if (!ref.verified) return UNVERIFIED_EXECUTOR;
      if (!best || tierRank(ref.tier) < tierRank(best.tier)) best = ref;
    }
    if (best) return best;
  } catch (err) {
    log.debug({ err, taskId }, 'executor lookup failed — treating the executor as unverified');
  }
  return UNVERIFIED_EXECUTOR;
}

/**
 * The executor's model id, or null when unverified. Kept for callers that only
 * record the id.
 *
 * @param taskId - Task under review / レビュー対象のタスクID
 * @returns Model id, or null when unverified / 未確認なら null
 */
export async function resolveExecutorModel(taskId: number): Promise<string | null> {
  return (await resolveExecutor(taskId)).modelId;
}
