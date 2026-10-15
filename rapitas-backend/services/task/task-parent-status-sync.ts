/**
 * TaskParentStatusSync
 *
 * Recomputes a parent task's status from all of its sibling subtasks'
 * statuses whenever a subtask's own status changes.
 * Not responsible for finalizing workflow-managed parents (verify.md,
 * auto-commit/PR) — that stays owned by subtask-completion-handler.ts.
 */
import { PrismaClient } from '../../generated/prisma-postgres';
import { realtimeService } from '../communication/realtime-service';

type PrismaInstance = InstanceType<typeof PrismaClient>;

/**
 * Recomputes and, if changed, persists the parent task's status from all
 * sibling subtask statuses: all `todo` → `todo`; any `in-progress` (or
 * `blocked`) → `in-progress`; all `done` → `done`; a mix of `done`+`todo`
 * only (no `in-progress`) → `in-progress`.
 *
 * Skips the `done` bucket when the parent is workflow-managed (its
 * `workflowStatus` is set) — that richer finalization (verify.md,
 * auto-commit/PR) is owned exclusively by `onSubtaskCompleted` in
 * subtask-completion-handler.ts. Applying `done` here too would race it:
 * this write is synchronous, onSubtaskCompleted's is a detached async
 * import, so if ours landed first its own idempotency guard
 * (`parentTask.status === 'done'` → return early) would skip finalization
 * entirely, silently losing verify.md/commit/PR (see task-430 in git
 * history for the class of bug a naive auto-complete here can reintroduce).
 *
 * The `done` deferral above used to strand a workflow-managed parent at
 * `in-progress` forever once `workflowStatus` reached `completed`: this
 * function would never re-apply `done`, and `onSubtaskCompleted`'s own
 * idempotency guard used to treat `workflowStatus === 'completed'` as
 * "nothing to do" and skip too. `onSubtaskCompleted` now reconciles
 * `status` to `done` itself in that case (without re-running verify.md/
 * auto-commit/PR), so this function only ever needs to defer the `done`
 * transition — moving the parent to `in-progress`/`todo` as subtasks are
 * reopened remains this function's job even after `workflowStatus` is
 * `completed`.
 *
 * @param prisma - Prisma client instance / Prismaクライアントインスタンス
 * @param parentId - The parent task's id / 親タスクのID
 */
export async function syncParentStatusFromSubtasks(
  prisma: PrismaInstance,
  parentId: number,
): Promise<void> {
  const [siblingStatuses, parent] = await Promise.all([
    prisma.task.findMany({ where: { parentId }, select: { status: true } }),
    prisma.task.findUnique({
      where: { id: parentId },
      select: { status: true, workflowStatus: true, title: true, priority: true, themeId: true },
    }),
  ]);

  if (!parent || siblingStatuses.length === 0) return;

  const statuses = siblingStatuses.map((s) => s.status);
  const allDone = statuses.every((s) => s === 'done');
  const anyInProgress = statuses.some((s) => s === 'in-progress' || s === 'blocked');
  const allTodo = statuses.every((s) => s === 'todo');

  const newParentStatus = allDone
    ? 'done'
    : anyInProgress
      ? 'in-progress'
      : allTodo
        ? 'todo'
        : 'in-progress'; // mix of done+todo only

  const skipDoneForWorkflowParent = newParentStatus === 'done' && parent.workflowStatus !== null;

  if (skipDoneForWorkflowParent || parent.status === newParentStatus) return;

  await prisma.task.update({
    where: { id: parentId },
    data: {
      status: newParentStatus,
      ...(newParentStatus === 'done' && { completedAt: new Date() }),
      ...(newParentStatus === 'in-progress' &&
        parent.status !== 'in-progress' && { startedAt: new Date() }),
      // Reopening a previously-done parent — clear the stale completion timestamp.
      ...(parent.status === 'done' && newParentStatus !== 'done' && { completedAt: null }),
    },
  });

  // NOTE: Broadcast the parent's own status change via SSE — without this, a
  // client already viewing the parent task never learns its status changed
  // (the subtask's own update broadcast only carries the SUBTASK's id/status)
  // and shows a stale value until the page is manually reloaded.
  realtimeService.sendTaskUpdate(
    parentId,
    newParentStatus === 'done' ? 'task_completed' : 'task_status_changed',
    {
      taskId: parentId,
      status: newParentStatus,
      title: parent.title,
      priority: parent.priority,
      themeId: parent.themeId,
      timestamp: new Date().toISOString(),
    },
  );
}
