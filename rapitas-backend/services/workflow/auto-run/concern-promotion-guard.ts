/**
 * concern-promotion-guard
 *
 * Keeps a concern the validator rejected from becoming a task. Not responsible
 * for choosing which concern to promote (backlog-promoter-execute.ts).
 *
 * NOTE: On 2026-11-20 the nightly scan had filed the same two trendline
 * security findings almost daily since 10/10, each time in new words, so the
 * hash dedupe never matched. The validator rejected most of them, yet the
 * critical-concern bypass promoted five rejected ones in a row (tasks
 * 1513-1517); each ran research through verify before blocking.
 *
 * Talks to the database directly rather than through concern-backlog-service:
 * the promoter's tests mock that module, and a new export there would break
 * every one of them.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';

const log = createLogger('auto-run:concern-promotion-guard');

/**
 * Retire a concern the validator rejected, instead of promoting it.
 *
 * Moved to `dismissed`, not merely skipped: the promoter picks one concern at
 * a time, so a skipped one would be picked again every cycle and nothing else
 * would ever be promoted. `dismissed` also blocks a re-filing with the same
 * hash. Fails open — an unreadable status promotes as before.
 *
 * @param concernId - Concern about to be promoted / 起票しようとしている懸念のID
 * @returns True when it was rejected and retired / 却下済みで退けた場合 true
 */
export async function retireIfRejected(concernId: number): Promise<boolean> {
  let row: { validationStatus: string | null } | null = null;
  try {
    row = await prisma.knowledgeEntry.findUnique({
      where: { id: concernId },
      select: { validationStatus: true },
    });
  } catch {
    return false;
  }
  if (row?.validationStatus !== 'rejected') return false;
  const retired = await prisma.knowledgeEntry
    .update({ where: { id: concernId }, data: { sourceId: 'dismissed' } })
    .then(() => true)
    .catch((err) => {
      log.warn({ err, concernId }, '[concern-promotion-guard] could not retire a rejected concern');
      return false;
    });
  if (retired) {
    log.info({ concernId }, '[concern-promotion-guard] Rejected concern retired, not promoted');
  }
  return true;
}
