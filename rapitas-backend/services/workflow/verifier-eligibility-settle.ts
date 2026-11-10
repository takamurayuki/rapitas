/**
 * verifier-eligibility-settle
 *
 * Settles a verify completion the HTTP save DEFERRED because the verifier had
 * not reported its actual model yet, on the manual execute route — which has
 * no CLI epilogue to judge again. Once the run has ended, the deferral becomes
 * a human hold: ineligible / unverified as such, and an eligible model too,
 * because on this route nothing re-runs the jury → commit/PR stages, and the
 * hold's override is the existing way to let them proceed. Not responsible for
 * the CLI path (workflow-cli-executor-verify-gate.ts re-judges there).
 */
import { createLogger } from '../../config/logger';
import {
  VERIFIER_ELIGIBILITY_DEFERRED_CAUSE,
  holdIfVerifierIneligible,
} from './verifier-eligibility';

const log = createLogger('workflow:verifier-eligibility-settle');

/**
 * After a manual verifier run ends, turn a still-open eligibility deferral
 * into a human hold. Never throws.
 *
 * @param taskId - Task whose verifier run just ended / タスクID
 * @param sessionId - The run's session / セッションID
 * @returns 'held' when a hold was written, 'none' when nothing was deferred, 'error' on failure / 結果
 */
export async function settleDeferredVerifierEligibility(
  taskId: number,
  sessionId?: number,
): Promise<'held' | 'none' | 'error'> {
  try {
    const { prisma } = await import('../../config/database');
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { workflowStatus: true, status: true, haltReason: true },
    });
    if (!task || task.workflowStatus !== 'verify_done' || task.status === 'done') return 'none';
    // Any halt already parks the task for a human (e.g. the jury held it after
    // the deferral); never overwrite that hold's reason.
    if (task.haltReason) return 'none';
    // Only when the newest verify save was deferred and nothing acted on it since.
    const latest = await prisma.workflowTransition.findFirst({
      where: { taskId, cause: { in: ['file_saved:verify', VERIFIER_ELIGIBILITY_DEFERRED_CAUSE] } },
      orderBy: { createdAt: 'desc' },
      select: { cause: true },
    });
    if (latest?.cause !== VERIFIER_ELIGIBILITY_DEFERRED_CAUSE) return 'none';

    const gate = await holdIfVerifierIneligible({
      taskId,
      source: 'manual_settle',
      sessionId,
      phase: 'after_run',
    });
    if (gate.outcome !== 'ok') return gate.outcome === 'cas_lost' ? 'error' : 'held';
    const j = gate.judgement;
    const model = j.status === 'eligible' ? j.model : '（判定対象の実行なし）';
    const { holdForHumanReview } = await import('./review-hold');
    const held = await holdForHumanReview({
      taskId,
      reason: 'ineligible_verifier',
      detail: `verify.md 保存の時点では検証役の実モデルが未報告だったため完了を保留した。実行後の報告は ${model}（適格）。確認のうえ上書きで先へ進める。`,
      findings: [],
      source: 'manual_settle',
      sessionId,
      extra: { verifierModel: j.status === 'eligible' ? j.model : null, settledEligible: true },
    });
    return held === 'held' ? 'held' : 'error';
  } catch (err) {
    log.warn({ err, taskId }, '[verifier-eligibility-settle] could not settle the deferral');
    return 'error';
  }
}
