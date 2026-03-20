/**
 * SubtaskCompletionHandler
 *
 * Monitors subtask completion and triggers parent task integration verification
 * when all subtasks are done. Generates the parent's verify.md from subtask results.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('subtask-completion');

/**
 * Check if all sibling subtasks are complete after one finishes.
 * If all done, generate the parent task's integration verify.md.
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

    const allDone = siblings.every((s) => s.status === 'done');
    const doneCount = siblings.filter((s) => s.status === 'done').length;
    const failedCount = siblings.filter((s) => s.status === 'todo' || s.status === 'failed').length;

    log.info(
      `[SubtaskCompletion] Subtask #${completedSubtaskId} done. Parent #${subtask.parentId}: ${doneCount}/${siblings.length} complete, ${failedCount} failed/pending`,
    );

    if (!allDone) return;

    // All subtasks complete — generate parent's integration verify.md
    const parentTask = await prisma.task.findUnique({
      where: { id: subtask.parentId },
      include: { theme: { include: { category: true } } },
    });

    if (!parentTask) return;

    const verifyContent = await buildIntegrationVerify(parentTask, siblings);

    // Save via workflow API (internal call)
    try {
      const res = await fetch(
        `http://localhost:3001/workflow/tasks/${subtask.parentId}/files/verify`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: verifyContent }),
        },
      );

      if (res.ok) {
        log.info(`[SubtaskCompletion] Generated integration verify.md for parent task #${subtask.parentId}`);
      } else {
        log.warn(`[SubtaskCompletion] Failed to save verify.md for parent task #${subtask.parentId}`);
      }
    } catch (err) {
      log.error({ err }, `[SubtaskCompletion] Failed to save verify.md for parent task #${subtask.parentId}`);
    }
  } catch (error) {
    log.error({ err: error }, `[SubtaskCompletion] Handler failed for subtask #${completedSubtaskId}`);
  }
}

/**
 * Build integration verify.md content from all subtask results.
 */
async function buildIntegrationVerify(
  parentTask: { id: number; title: string; theme?: { categoryId?: number | null } | null; themeId: number | null },
  subtasks: Array<{ id: number; title: string; status: string }>,
): Promise<string> {
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
  lines.push(allPassed
    ? 'All subtasks completed. Ready for final review.'
    : 'Some subtasks have issues. Manual review required.',
  );

  return lines.join('\n');
}
