/**
 * critic-rejection-guard
 *
 * Shared predicate for every artifact-harvest path: has the phase critic
 * REJECTED this phase's artifact since the phase started? Re-saving the
 * agent's final message after a rejection resurrects the bounced content
 * byte-for-byte and flips the workflow status forward again, silently
 * nullifying the critic gate. Task 539 hit this through the manual-execution
 * harvest (research-phase-handler), which lacked the guard the auto-run
 * executor already had.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';

const log = createLogger('critic-rejection-guard');

/**
 * Check whether the phase critic recorded a rejection for this artifact
 * after the given instant.
 *
 * Fail-open: a DB error returns false (allow the save) because blocking every
 * harvest on a transient DB failure would strand phases with no artifact at
 * all — the critic can bounce the artifact again on the next pass.
 *
 * @param taskId - Task whose artifact is about to be saved. / 保存対象タスクID
 * @param fileType - Workflow file type being saved. / 保存するファイル種別
 * @param since - Phase start (or execution start) boundary. / フェーズ開始時刻
 * @returns true when a `<fileType>_critic_failed` transition exists after `since`. / 差し戻し済みならtrue
 */
export async function criticRejectedSince(
  taskId: number,
  fileType: string,
  since: Date,
): Promise<boolean> {
  // Only research/plan pass through the phase critic; other file types never
  // have a rejection to resurrect.
  if (fileType !== 'research' && fileType !== 'plan') return false;
  try {
    const hit = await prisma.workflowTransition.findFirst({
      where: {
        taskId,
        cause: `${fileType}_critic_failed`,
        createdAt: { gt: since },
      },
      select: { id: true },
    });
    if (hit) {
      log.warn(
        { taskId, fileType, since: since.toISOString() },
        '[critic-rejection-guard] Artifact was rejected by the phase critic after phase start — harvest save must be skipped',
      );
    }
    return !!hit;
  } catch (err) {
    log.warn(
      { err, taskId, fileType },
      '[critic-rejection-guard] Transition lookup failed — failing open (allowing save)',
    );
    return false;
  }
}
