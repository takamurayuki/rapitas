/**
 * workflow-runner-halt-guard
 *
 * Stops an ALREADY-DEQUEUED queue item before it dispatches its next agent
 * phase, when the task was halted mid-flight by the iteration budget. Not
 * responsible for selection-time exclusion (auto-run-eligibility /
 * auto-run-advance-select own that) nor for setting the halt itself.
 */
// NOTE: prisma comes from the '../../config' barrel — the same specifier
// workflow-runner.ts uses. Importing '../../config/database' directly would make
// every runner test that mocks only the barrel fall through to a real client
// (bun's mock.module is process-global, so a narrow second mock then leaks into
// unrelated suites).
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';

const log = createLogger('workflow-runner');

/**
 * Phases the runner settles through its own branches rather than by dispatching
 * a new agent. A halt must NOT interrupt these: `verify_done` is the publication
 * of work that is already paid for (commit/PR/merge of a finished diff), and
 * `plan_created`/`completed` spend nothing. Blocking them would strand finished
 * work instead of stopping new spend.
 */
const NON_DISPATCH_PHASES = new Set(['completed', 'verify_done', 'plan_created']);

/** The subset of WorkflowQueueService this guard needs (kept structural to avoid an import cycle). */
type QueueStatusWriter = {
  updateStatus(
    id: number,
    status: string,
    extra?: { currentPhase?: string; errorMessage?: string },
  ): Promise<unknown>;
};

/**
 * Resolve the halt reason that must stop this item before the next agent phase.
 *
 * Fail-open by design: an unreadable halt state returns null so a transient DB
 * error never strands a healthy item. The selection-side guards already refuse
 * to pick a halted task, so a missed halt here costs one phase at worst.
 *
 * @param taskId - Task whose next phase is about to be dispatched. / 次フェーズを発行しようとしているタスクID
 * @param phase - The task's current workflowStatus. / 現在のワークフローフェーズ
 * @returns The halt reason to park on, or null when the item may proceed. / 停止理由、続行可なら null
 */
export async function resolveInflightHaltReason(
  taskId: number,
  phase: string,
): Promise<string | null> {
  if (NON_DISPATCH_PHASES.has(phase)) return null;
  try {
    const row = await prisma.task.findUnique({
      where: { id: taskId },
      select: { haltReason: true },
    });
    return row?.haltReason ?? null;
  } catch {
    return null;
  }
}

/**
 * Human-readable reason recorded on the parked queue item.
 *
 * @param taskId - Parked task. / 対象タスク
 * @param phase - Phase that was about to be dispatched. / 発行しようとしていたフェーズ
 * @param haltReason - Task.haltReason value. / halt 理由
 * @returns Message for WorkflowQueueItem.errorMessage. / キュー項目に記録する文面
 */
export function haltParkMessage(taskId: number, phase: string, haltReason: string): string {
  return `Task ${taskId} is halted (${haltReason}) — parked before dispatching phase '${phase}'. Release the halt to resume.`;
}

/**
 * Park the item when its task is halted, so the halt actually stops new spend.
 *
 * Before this existed the halt only excluded a task from SELECTION, and an item
 * already dequeued kept dispatching phase after phase past its budget (task
 * 1107, 2026-09-27: halted 05:42, implementer 05:50, verify 05:54, a 35-file
 * auto-commit 05:55). Parking as 'cancelled' matches the vanished-task guard:
 * no retry is consumed, and releasing the halt re-enqueues a fresh item.
 *
 * @param queue - Queue service used to write the item's status. / キュー項目の状態を書き込むサービス
 * @param item - The in-flight queue item. / 実行中のキュー項目
 * @param phase - The task's current workflowStatus. / 現在のワークフローフェーズ
 * @param notify - Broadcast callback (the runner supplies its active-count). / 通知コールバック
 * @returns true when the item was parked and the loop must stop. / parked したら true
 */
export async function parkItemIfHalted(
  queue: QueueStatusWriter,
  item: { id: number; taskId: number },
  phase: string,
  notify: (event: string, phase: string) => void,
): Promise<boolean> {
  const haltReason = await resolveInflightHaltReason(item.taskId, phase);
  if (!haltReason) return false;
  await queue.updateStatus(item.id, 'cancelled', {
    errorMessage: haltParkMessage(item.taskId, phase, haltReason),
    currentPhase: phase,
  });
  log.warn(
    { taskId: item.taskId, phase, haltReason },
    '[WorkflowRunner] Task is halted — parking item without dispatching the next phase',
  );
  notify('execution_error', phase);
  return true;
}
