/**
 * Orchestra Routes
 *
 * Subtask execution entry point for split parent tasks.
 * NOTE: The manual "conduct multiple tasks" control panel (start/stop/resume/
 * queue/sessions/events/runner endpoints + its /orchestra UI page) was removed
 * as unused — subtask execution drives the AIOrchestra service directly via
 * enqueueSubtasksForExecution, so only the run-subtasks endpoint remains.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../config';
import { ValidationError } from '../../middleware/error-handler';
import { AIOrchestra } from '../../services/workflow/ai-orchestra';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:orchestra');

export const orchestraRoutes = new Elysia()

  /**
   * POST /workflow/orchestra/run-subtasks — 親タスクのサブタスクを実行/再実行
   *
   * Runs the subtasks of a split parent. When there are no runnable (pending)
   * subtasks left (i.e. they all finished on a previous run, or the parent was
   * reset), the not-cancelled subtasks are reset back to a runnable state so
   * "実行" re-runs them from scratch. This backs the parent task's run button,
   * which the FE used to route to a no-op stub (so a split task could never be
   * executed again after the initial auto-run).
   */
  .post('/workflow/orchestra/run-subtasks', async ({ body }) => {
    const { taskId } = body as { taskId: number };
    if (!taskId) {
      throw new ValidationError('taskId is required');
    }

    const subtasks = await prisma.task.findMany({
      where: { parentId: taskId },
      select: { id: true, status: true },
    });
    if (subtasks.length === 0) {
      throw new ValidationError('Task has no subtasks to run');
    }

    const pending = subtasks.filter(
      (s) => !['done', 'cancelled', 'archived'].includes(s.status),
    );

    // No pending work → treat the click as a re-run: reset every not-cancelled
    // subtask to a runnable state, then enqueue them all again.
    let reRun = false;
    if (pending.length === 0) {
      reRun = true;
      const resetIds = subtasks
        .filter((s) => !['cancelled', 'archived'].includes(s.status))
        .map((s) => s.id);
      if (resetIds.length > 0) {
        await prisma.task.updateMany({
          where: { id: { in: resetIds } },
          data: {
            status: 'todo',
            workflowStatus: 'draft',
            startedAt: null,
            completedAt: null,
          },
        });
        // Cancel any lingering queue items so the re-enqueue is not rejected
        // as a duplicate.
        await prisma.workflowQueueItem
          .updateMany({
            where: {
              taskId: { in: resetIds },
              status: { in: ['queued', 'running', 'waiting_approval'] },
            },
            data: { status: 'cancelled', completedAt: new Date(), errorMessage: 'Re-run by user' },
          })
          .catch((err) => {
            log.warn({ err, taskId }, '[Orchestra] Failed to cancel subtask queue items on re-run');
          });
      }
    }

    const orchestra = AIOrchestra.getInstance();
    const enqueued = await orchestra.enqueueSubtasksForExecution(taskId);
    log.info({ taskId, enqueued, reRun }, '[Orchestra] run-subtasks');
    return { success: true, enqueued, reRun, subtaskCount: subtasks.length };
  });
