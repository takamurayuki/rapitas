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
import { resolveTaskSubtaskInfo, resolveTaskWithThemeAndCategory } from '../task/task-resolver';

const log = createLogger('subtask-completion');

/** Minimal subtask shape needed to judge completion. */
type SubtaskState = { status: string; workflowStatus: string | null };

// A subtask's progress is tracked across TWO fields (task.status and
// task.workflowStatus) that several code paths update independently, so they can
// momentarily diverge (e.g. auto-approve advances workflowStatus but not status).
// Judge completion from BOTH so a lagging field can never strand the parent.

/** A subtask is finished once verify passed OR its task reached a terminal status. */
export function isSubtaskFinished(s: SubtaskState): boolean {
  return (
    s.workflowStatus === 'completed' ||
    ['done', 'completed', 'failed', 'cancelled', 'archived'].includes(s.status)
  );
}

/** A subtask failed when its task was failed/cancelled. */
export function isSubtaskFailed(s: SubtaskState): boolean {
  return s.status === 'failed' || s.status === 'cancelled';
}

/** A subtask passed when it finished successfully (verify completed / done). */
export function isSubtaskPassed(s: SubtaskState): boolean {
  return (
    !isSubtaskFailed(s) &&
    (s.workflowStatus === 'completed' || s.status === 'done' || s.status === 'completed')
  );
}

/**
 * Check if all sibling subtasks are complete after one finishes.
 * If all done, generate the parent task's integration verify.md and finalize
 * the parent's status.
 *
 * NOTE: this is the single place that drives a split parent to completion, so
 * it writes verify.md to disk directly and sets the parent's terminal status
 * here instead of routing through the HTTP file-save handler (which would
 * reject verify.md unless the parent were in_progress). It then runs the auto-
 * commit/PR pipeline against the parent: in practice the agent often does the
 * whole implementation in the PARENT's worktree, and without this its changes
 * were stranded uncommitted (no other path commits a split parent).
 *
 * @param completedSubtaskId - ID of the just-completed subtask / 完了したサブタスクID
 */
export async function onSubtaskCompleted(completedSubtaskId: number): Promise<void> {
  try {
    const subtask = await resolveTaskSubtaskInfo(completedSubtaskId);

    if (!subtask?.parentId) return;

    const siblings = await prisma.task.findMany({
      where: { parentId: subtask.parentId },
      select: { id: true, title: true, status: true, workflowStatus: true },
    });

    // Finalize the parent once every subtask has reached a TERMINAL state
    // (done / failed / cancelled). Gating on "all done" alone would leave the
    // parent hanging forever if a subtask permanently failed. Completion is read
    // from BOTH status fields (see isSubtaskFinished) so a lagging field can't
    // strand the parent — the bug that previously lost a split parent's work.
    const stillRunning = siblings.filter((s) => !isSubtaskFinished(s));
    const doneCount = siblings.filter(isSubtaskPassed).length;
    const failedCount = siblings.filter(isSubtaskFailed).length;

    log.info(
      `[SubtaskCompletion] Subtask #${completedSubtaskId} done. Parent #${subtask.parentId}: ${doneCount}/${siblings.length} complete, ${stillRunning.length} still running`,
    );

    if (stillRunning.length > 0) return;

    // All subtasks complete — generate parent's integration verify.md
    const parentTask = await resolveTaskWithThemeAndCategory(subtask.parentId);

    if (!parentTask) return;

    // Idempotency guard: if the parent is already terminal, do not re-finalize
    // (sibling completions can race onto this handler concurrently).
    if (parentTask.status === 'done' || parentTask.workflowStatus === 'completed') {
      return;
    }

    const allPassed = siblings.every(isSubtaskPassed);
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

    // Commit/PR the parent's worktree. A split parent's implementation usually
    // lands in ITS worktree (the agent does the work there rather than per
    // subtask), but no other path commits a split parent — so its changes were
    // stranded uncommitted and never reached the repo. Run the same auto-
    // commit/PR pipeline the HTTP verify handler uses (it no-ops when the user
    // hasn't enabled auto-commit, and is gated by the verification check).
    if (allPassed) {
      try {
        const { performAutoCommitAndPR } =
          await import('../../routes/workflow/workflow-auto-commit');
        await performAutoCommitAndPR(parentTask.id, verifyContent);
      } catch (err) {
        log.warn(
          { err, parentId: parentTask.id },
          '[SubtaskCompletion] Parent auto-commit/PR failed (non-fatal)',
        );
      }
    }
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
  subtasks: Array<{ id: number; title: string; status: string; workflowStatus: string | null }>,
): string {
  const lines: string[] = [];

  lines.push(`# Integration Verification: ${parentTask.title}`);
  lines.push('');
  lines.push(`## Subtask Summary`);
  lines.push('');

  let allPassed = true;

  for (const st of subtasks) {
    const passed = isSubtaskPassed(st);
    lines.push(`- ${passed ? '✅' : '❌'} #${st.id}: ${st.title}`);

    if (!passed) {
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
