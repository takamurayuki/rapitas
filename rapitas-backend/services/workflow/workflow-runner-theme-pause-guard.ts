/**
 * workflow-runner-theme-pause-guard
 *
 * Hands the global auto-run slot back before an in-flight item dispatches its next phase
 * when its theme has been paused/stopped. Not responsible for the slot count itself
 * (auto-run-global-active-count) nor for the budget halt (workflow-runner-halt-guard).
 */
// NOTE: prisma comes from the '../../config' barrel for the same reason as the halt guard
// (bun's mock.module is process-global; a second narrow mock would leak into other suites).
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';

const log = createLogger('workflow-runner');

type QueueStatusWriter = {
  updateStatus(id: number, status: string, extra?: { currentPhase?: string }): Promise<unknown>;
};

/**
 * Requeue the item when its theme is paused or stopping, so the next phase does not take a slot.
 *
 * The phase that just finished is allowed to end; only the following one is held back. The
 * item returns to `queued`, which queue-theme-guard keeps undispatchable until the theme
 * runs again, so resuming picks it up without a new enqueue. Fail-open: an unreadable theme
 * state never strands a healthy item.
 *
 * @param queue - Queue service used to write the item's status. / キュー項目の状態を書き込むサービス
 * @param item - The in-flight queue item. / 実行中のキュー項目
 * @param phase - The task's current workflowStatus, kept as currentPhase. / 現在のフェーズ
 * @param notify - Broadcast callback. / 通知コールバック
 * @returns true when the item was requeued and the loop must stop. / 戻したら true
 */
export async function parkItemIfThemeHalted(
  queue: QueueStatusWriter,
  item: { id: number; taskId: number },
  phase: string,
  notify: (event: string, phase: string) => void,
): Promise<boolean> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: item.taskId },
      select: { themeId: true },
    });
    if (task?.themeId == null) return false;
    const run = await prisma.themeAutoRun.findFirst({
      where: { themeId: task.themeId },
      select: { status: true },
    });
    const status = run?.status ?? '';
    if (!status.startsWith('paused') && status !== 'stopping') return false;
    await queue.updateStatus(item.id, 'queued', { currentPhase: phase });
    log.info(
      { taskId: item.taskId, themeId: task.themeId, phase, themeStatus: status },
      '[WorkflowRunner] Theme is paused — requeued item before next phase to release the slot',
    );
    notify('execution_requeued', phase);
    return true;
  } catch (err) {
    log.warn(
      { taskId: item.taskId, err },
      '[WorkflowRunner] Theme pause check failed — proceeding',
    );
    return false;
  }
}
