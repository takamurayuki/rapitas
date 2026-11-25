/**
 * verify-settle-live-verifier
 *
 * Tells the verify settle wait whether the task's verifier agent is still
 * running, or exited only a moment ago. Commit / PR creation starts only after
 * the verifier exits, so a verifier that saved verify.md but has not exited —
 * or has just exited and not yet handed over to the epilogue — is work in
 * progress, not a stuck task. Not responsible for the settle loop itself.
 */
import { prisma } from '../../config/database';

/**
 * How long after an agent of the task exits it still counts as working.
 *
 * NOTE: Task 1548 (2026-11-26): its verifier exited at 02:47:12 and the
 * epilogue registered its commit / PR work at 02:47:30. The settle wait looked
 * at 02:47:23, found nothing alive and nothing in flight, and blocked the task
 * before its PR. 60 s covers that hand-over with margin. / 終了直後の猶予
 */
export const VERIFIER_EXIT_GRACE_MS = 60_000;

/**
 * Whether one of the task's agents is alive with a fresh heartbeat, or exited
 * within {@link VERIFIER_EXIT_GRACE_MS}. A failed lookup answers false, so the
 * settle window behaves as before.
 *
 * @param taskId - Task being settled / 判定中のタスクID
 * @returns True while an agent of the task is alive or just exited / 生存中または終了直後なら true
 */
export async function isVerifierStillRunning(taskId: number): Promise<boolean> {
  try {
    const { hasLiveExecution } = await import('./auto-run/auto-run-selection');
    if (await hasLiveExecution(prisma, taskId)) return true;
    const justExited = await prisma.agentExecution.findFirst({
      where: {
        session: { config: { taskId } },
        completedAt: { gte: new Date(Date.now() - VERIFIER_EXIT_GRACE_MS) },
      },
      select: { id: true },
    });
    return justExited != null;
  } catch {
    return false;
  }
}
