/**
 * verify-settle-live-verifier
 *
 * Tells the verify settle wait whether the task's verifier agent is still
 * running. Commit / PR creation starts only after the verifier exits, so a
 * verifier that saved verify.md but has not exited is work in progress, not a
 * stuck task. Not responsible for the settle loop itself.
 */
import { prisma } from '../../config/database';

/**
 * Whether one of the task's agents is still running with a fresh heartbeat.
 * A failed lookup answers false, so the settle window behaves as before.
 *
 * @param taskId - Task being settled / 判定中のタスクID
 * @returns True while an agent of the task is alive / エージェントが生きていれば true
 */
export async function isVerifierStillRunning(taskId: number): Promise<boolean> {
  try {
    const { hasLiveExecution } = await import('./auto-run/auto-run-selection');
    return await hasLiveExecution(prisma, taskId);
  } catch {
    return false;
  }
}
