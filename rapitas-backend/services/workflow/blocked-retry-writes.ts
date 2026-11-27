/**
 * blocked-retry-writes
 *
 * The two small DB writes the blocked auto-retry shares: annotating its transition
 * row and completing a task whose PR is recorded as merged. Not responsible for
 * deciding either (see blocked-retry-resume-stage / blocked-retry-dispatch).
 */
import type { PrismaClient } from '../../generated/prisma-postgres';
import { createLogger } from '../../config/logger';

const log = createLogger('blocked-retry-writes');

/**
 * Annotate the newest `blocked_auto_retry` row with the final metadata.
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param taskId - Task whose row is annotated. / 対象タスク
 * @param metadata - Full metadata to store. / 保存するmetadata
 */
export async function annotateRetryRow(
  prisma: PrismaClient,
  taskId: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  // NOTE: annotate the row recorded earlier rather than writing a second cause —
  // MAX_BLOCKED_RETRY counts `blocked_auto_retry` rows and detectors read the
  // newest cause, so an extra transition would change both.
  try {
    const row = await prisma.workflowTransition.findFirst({
      where: { taskId, cause: 'blocked_auto_retry' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (row) {
      await prisma.workflowTransition.update({
        where: { id: row.id },
        data: { metadata: JSON.stringify(metadata) },
      });
    }
  } catch (err) {
    log.warn({ err, taskId }, '[blocked-retry] could not annotate dispatch outcome');
  }
}

/**
 * Completes a blocked task whose PR is recorded as merged (CAS on status=blocked and not excluded).
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param taskId - Task to complete. / 対象タスク
 * @returns True when the completion was written. / 書き込めたら true
 */
export async function completeMergedTask(prisma: PrismaClient, taskId: number): Promise<boolean> {
  const { completeWithRecord } = await import('../notes/deliverables/deliverable-completion');
  return completeWithRecord(prisma as never, taskId, 'reconciler_restore', (db, at) =>
    db.task.updateMany({
      where: { id: taskId, status: 'blocked', autoRunExcluded: false },
      data: { status: 'done', workflowStatus: 'completed', completedAt: at, updatedAt: at },
    }),
  ).catch(() => false);
}
