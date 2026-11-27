/**
 * GuardedStart
 *
 * The one admission every new phase start passes through. Taken inside the
 * restart gate: while a restart wait is in force the start is refused (and the
 * task remembered so the advance is replayed later); otherwise the advance is
 * registered in the execution ledger before the gate is released, so a wait that
 * begins right after still sees it as running.
 * The gate covers only this admission, never the phase itself.
 */
import { registerExecution } from './execution-ledger';
import { AsyncLocalStorage } from 'node:async_hooks';
import { withRestartGate } from './restart-gate';
import { isRestartWaitActive } from './restart-wait';
import { addDeferredAdvance } from './restart-wait-store';

/** A granted start; call `release` when the advance has finished (success or failure). */
export interface AdvanceAdmission {
  release(): void;
}

const admitted = new AsyncLocalStorage<{
  taskId: number;
  admission: AdvanceAdmission;
  consumed: boolean;
  closed: boolean;
}>();

/** 全入口の登録区間。完了Promiseは返り値の中に包み、完了までロックを保持しない。 */
export function guardedStart<T>(start: () => Promise<T>, waiting: () => Promise<T>): Promise<T> {
  return withRestartGate(() => (isRestartWaitActive() ? waiting() : start()));
}

/** ロック取得済みの呼び出し元が登録を引き渡す。引き渡しは一度だけ使用できる。 */
export async function withAdmittedAdvance<T>(
  taskId: number,
  start: () => Promise<{ completion: Promise<T> } | null>,
): Promise<{ completion: Promise<T> } | null> {
  const admission = { release: registerExecution(taskId) };
  const scope = { taskId, admission, consumed: false, closed: false };
  const releaseUnclaimed = () => {
    if (!scope.consumed) admission.release();
  };
  try {
    const result = await admitted.run(scope, start);
    if (!result) {
      releaseUnclaimed();
      return null;
    }
    // 引渡し済みなら実orchestratorのfinallyが所有する。runnerのtimeoutでは消さない。
    return { completion: result.completion.finally(releaseUnclaimed) };
  } catch (error) {
    releaseUnclaimed();
    throw error;
  } finally {
    scope.closed = true;
  }
}

/**
 * Ask to start (or continue into) a phase of a task.
 *
 * @param taskId - Task whose workflow is about to advance / 進めるタスクID
 * @returns The admission, or null when a restart wait refused it (the task is saved for replay) / 許可、拒否時はnull
 */
export function admitAdvance(taskId: number): Promise<AdvanceAdmission | null> {
  const inherited = admitted.getStore();
  if (inherited?.taskId === taskId && !inherited.consumed && !inherited.closed) {
    inherited.consumed = true;
    return Promise.resolve(inherited.admission);
  }
  return guardedStart(
    async () => ({ release: registerExecution(taskId) }),
    async () => {
      const { prisma } = await import('../../../config');
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { themeId: true, workflowStatus: true },
      });
      if (
        task &&
        !addDeferredAdvance(taskId, task.themeId ?? null, task.workflowStatus ?? undefined)
      )
        throw new Error('保留advanceを保存できませんでした');
      return null;
    },
  );
}
