/**
 * RuntimeVerificationStage
 *
 * Runs the runtime smoke check as one heavy check and preserves its failures
 * as evidence rather than silently omitting the check. Not responsible for the
 * smoke check itself (runtime-smoke/).
 */
import type { VerificationCheck } from './automated-verifier';
import { createLogger } from '../../../config/logger';
import { withHeavyCheckSlot } from './heavy-check-slot';
const log = createLogger('verification:runtime-stage');

/**
 * Runs the runtime smoke check while holding the cross-task heavy-check slot
 * (task 1553): launching the app and driving the browser is as heavy as a
 * tsc, so another task's tsc/tests wait for it and vice versa. The slot covers
 * launch, the browser check and the lease release done inside
 * runRuntimeSmokeCheck; an idle server left in the registry afterwards holds
 * no slot. The runtime's own timers start inside runRuntimeSmokeCheck, so time
 * spent waiting for the slot is never counted against them.
 *
 * NOTE: Nothing under runtime-smoke/ may take the heavy slot (runCmd heavy /
 * withHeavyCheckSlot) — it would wait on the slot this stage holds and deadlock.
 *
 * @param workdir - Worktree to check. / 検査する worktree
 * @param taskId - Task id, for leases and logs. / タスク ID
 * @returns The runtime check, or an unverifiable one when it could not run. / runtime の検査結果
 */
export async function runRuntimeVerificationStage(
  workdir: string,
  taskId?: number,
): Promise<VerificationCheck | null> {
  try {
    const { runRuntimeSmokeCheck } = await import('./runtime-smoke');
    return await withHeavyCheckSlot(`runtime-smoke:${taskId ?? 'adhoc'}`, () =>
      runRuntimeSmokeCheck(workdir, 'adhoc', taskId),
    );
  } catch (err) {
    log.warn({ err, workdir }, 'Runtime verification could not execute');
    return {
      name: 'runtime',
      ran: false,
      ok: false,
      unverifiable: true,
      errorCount: 0,
      details: `Runtime verification unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
