/**
 * subtask-split-guard
 *
 * Detection net for child tasks created while subtask splitting is disabled:
 * warns (log + notification) when a subtask lands under a parent that is in
 * the planner phase, without blocking the creation itself.
 * Not responsible for rejecting requests — legitimate manual subtask creation
 * from the UI must keep working unchanged.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { createNotification } from '../communication/notification-service';
import { isSubtaskSplitEnabled } from './subtask-split-policy';

const log = createLogger('services:workflow:subtask-split-guard');

/**
 * Warns when a child task is created while the split chain is disabled and the
 * parent is in the planner phase (`workflowStatus === 'research_done'`).
 *
 * Soft warn, not a reject: hard-rejecting parentId creations would break the
 * UI's manual subtask creation (useSubtaskManagement.ts sends no
 * distinguishing header). The `research_done` check scopes the warning to the
 * exact window where a planner agent runs (research_done → planner →
 * plan_created), so normal UI operations stay silent. Best-effort by design —
 * a DB/notification failure here must never affect the creation response.
 *
 * @param task - The task just created (from createTask's return value) / 作成直後のタスク
 * @returns Resolves when the check (and any warning) completes / 判定完了時に解決
 */
export async function warnIfSubtaskCreatedDuringDisabledSplit(task: {
  id: number;
  parentId: number | null;
  title: string;
}): Promise<void> {
  if (isSubtaskSplitEnabled()) return;
  if (!task.parentId) return;

  const parent = await prisma.task
    .findUnique({
      where: { id: task.parentId },
      select: { workflowStatus: true, title: true },
    })
    .catch(() => null);
  if (!parent || parent.workflowStatus !== 'research_done') return;

  // Log unconditionally BEFORE the notification attempt so the event is never
  // fully silent even when notification creation fails.
  log.warn(
    {
      parentId: task.parentId,
      parentTitle: parent.title,
      newTaskId: task.id,
      newTaskTitle: task.title,
    },
    '[subtask-split-guard] Child task created while RAPITAS_ENABLE_SUBTASK_SPLIT is disabled and the parent is in the planner phase — a planner agent may be splitting against the flag (see task 545)',
  );

  await createNotification({
    type: 'system',
    title: 'サブタスク分割が無効な状態で子タスクが作成されました',
    message: `親タスク「${parent.title}」(research_done) の下に子タスク「${task.title}」が作成されました。RAPITAS_ENABLE_SUBTASK_SPLIT が無効のためサブタスクは自動実行されません。planner がフラグに反して分割した可能性があります。`,
    link: `/tasks/${task.parentId}`,
    metadata: { parentId: task.parentId, newTaskId: task.id },
  }).catch((err) => {
    log.error(
      { err, parentId: task.parentId, newTaskId: task.id },
      '[subtask-split-guard] Failed to create warning notification',
    );
  });
}
