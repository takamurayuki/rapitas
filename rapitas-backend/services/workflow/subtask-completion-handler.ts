/**
 * SubtaskCompletionHandler
 *
 * Monitors subtask completion and finalizes the parent task when all of its
 * subtasks are done. Generates the parent's integration verify.md and marks
 * the parent completed (or blocked, if a subtask failed).
 * Not responsible for running the subtasks themselves (see AIOrchestra).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { realtimeService } from '../communication/realtime-service';
import { writeWorkflowFile } from './workflow-file-utils';
import { getTaskWorkflowDir } from './workflow-paths';
import { recordTransition } from './transition-recorder';

const log = createLogger('subtask-completion');

/**
 * Check if all sibling subtasks are complete after one finishes.
 * If all done, generate the parent task's integration verify.md and finalize
 * the parent's status.
 *
 * NOTE: this is the single place that drives a split parent to completion.
 * The parent never implements directly — its subtasks do — so neither the
 * parent's own verify phase nor an auto-PR ever fires for it. We therefore
 * write verify.md to disk directly and set the parent's terminal status here
 * instead of routing through the HTTP file-save handler (which would reject
 * verify.md unless the parent were in_progress, and would try to open an
 * empty PR against the parent's change-less worktree).
 *
 * @param completedSubtaskId - ID of the just-completed subtask / 完了したサブタスクID
 */
export async function onSubtaskCompleted(completedSubtaskId: number): Promise<void> {
  try {
    const subtask = await prisma.task.findUnique({
      where: { id: completedSubtaskId },
      select: { parentId: true, title: true },
    });

    if (!subtask?.parentId) return;

    const siblings = await prisma.task.findMany({
      where: { parentId: subtask.parentId },
      select: { id: true, title: true, status: true },
    });

    // Finalize the parent once every subtask has reached a TERMINAL state
    // (done / failed / cancelled). Gating on "all done" alone would leave the
    // parent hanging forever if a subtask permanently failed.
    const TERMINAL = ['done', 'failed', 'cancelled', 'archived'];
    const stillRunning = siblings.filter((s) => !TERMINAL.includes(s.status));
    const doneCount = siblings.filter((s) => s.status === 'done').length;
    const failedCount = siblings.filter(
      (s) => s.status === 'failed' || s.status === 'cancelled',
    ).length;

    log.info(
      `[SubtaskCompletion] Subtask #${completedSubtaskId} done. Parent #${subtask.parentId}: ${doneCount}/${siblings.length} complete, ${stillRunning.length} still running`,
    );

    if (stillRunning.length > 0) return;

    // All subtasks complete — generate parent's integration verify.md
    const parentTask = await prisma.task.findUnique({
      where: { id: subtask.parentId },
      include: { theme: { include: { category: true } } },
    });

    if (!parentTask) return;

    // Idempotency guard: if the parent is already terminal, do not re-finalize
    // (sibling completions can race onto this handler concurrently).
    if (parentTask.status === 'done' || parentTask.workflowStatus === 'completed') {
      return;
    }

    const allPassed = siblings.every((s) => s.status === 'done');
    const verifyContent = buildIntegrationVerify(parentTask, siblings);

    // Write verify.md straight to the parent's workflow dir (no HTTP round-trip).
    try {
      const dir = getTaskWorkflowDir(
        parentTask.theme?.categoryId ?? null,
        parentTask.themeId ?? null,
        parentTask.id,
      );
      await writeWorkflowFile(dir, 'verify', verifyContent, parentTask.id);
    } catch (err) {
      log.warn(
        { err, parentId: subtask.parentId },
        '[SubtaskCompletion] Failed to write integration verify.md (continuing to finalize status)',
      );
    }

    // Finalize parent status. allPassed → done/completed; otherwise leave the
    // task blocked for the user to inspect the failed subtask(s).
    const fromWorkflowStatus = parentTask.workflowStatus ?? null;
    await prisma.task.update({
      where: { id: parentTask.id },
      data: allPassed
        ? { status: 'done', workflowStatus: 'completed', completedAt: new Date() }
        : { status: 'blocked', workflowStatus: 'verify_done' },
    });

    await recordTransition({
      taskId: parentTask.id,
      fromStatus: fromWorkflowStatus,
      toStatus: allPassed ? 'completed' : 'verify_done',
      actor: 'system',
      cause: allPassed ? 'all_subtasks_completed' : 'subtask_failed',
      phase: 'verify',
      metadata: {
        subtaskCount: siblings.length,
        doneCount,
        failedCount,
      },
    }).catch(() => {});

    realtimeService.broadcast('tasks', allPassed ? 'task_completed' : 'task_updated', {
      taskId: parentTask.id,
      status: allPassed ? 'done' : 'blocked',
      workflowStatus: allPassed ? 'completed' : 'verify_done',
      timestamp: new Date().toISOString(),
    });

    log.info(
      `[SubtaskCompletion] Parent task #${subtask.parentId} finalized: ${allPassed ? 'completed' : 'blocked'}`,
    );
  } catch (error) {
    log.error(
      { err: error },
      `[SubtaskCompletion] Handler failed for subtask #${completedSubtaskId}`,
    );
  }
}

/**
 * Build integration verify.md content from all subtask results.
 *
 * @param parentTask - The parent task being finalized. / 完了させる親タスク
 * @param subtasks - All sibling subtasks with their statuses. / 全サブタスク
 * @returns Markdown content for the parent's verify.md. / verify.md の内容
 */
function buildIntegrationVerify(
  parentTask: { id: number; title: string },
  subtasks: Array<{ id: number; title: string; status: string }>,
): string {
  const lines: string[] = [];

  lines.push(`# Integration Verification: ${parentTask.title}`);
  lines.push('');
  lines.push(`## Subtask Summary`);
  lines.push('');

  let allPassed = true;

  for (const st of subtasks) {
    const status = st.status === 'done' ? '✅' : '❌';
    lines.push(`- ${status} #${st.id}: ${st.title}`);

    if (st.status !== 'done') {
      allPassed = false;
    }
  }
  lines.push('');

  lines.push('## Integration Check');
  lines.push(`- [${allPassed ? 'x' : ' '}] All subtasks completed successfully`);
  lines.push('- [ ] No regression in existing functionality');
  lines.push('- [ ] Integration points between subtasks verified');
  lines.push('');

  lines.push('## Overall Result');
  lines.push(
    allPassed
      ? 'All subtasks completed. Ready for final review.'
      : 'Some subtasks have issues. Manual review required.',
  );

  return lines.join('\n');
}
