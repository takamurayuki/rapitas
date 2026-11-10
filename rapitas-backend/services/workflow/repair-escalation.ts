/**
 * repair-escalation
 *
 * Reads a task's repair bounces in the current repair window and counts them
 * by cause (repair-cause.ts), so routing can count VERIFIED capability gaps
 * as retries. The repair loop bounces a task back to the implementer without
 * touching the queue's retryCount, so without this the next implementer run
 * kept its floor, its pin key and therefore its model (routing-eval §3.2).
 * Not responsible for bouncing, replanning or blocking.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { REPAIR_CAUSE, resolveRepairWindowStart } from './verify-self-repair-budget';
import { classifyRepairCause, type RepairCauseKind, type RepairFindingLike } from './repair-cause';

const log = createLogger('workflow:repair-escalation');

/** Cause recorded right after a jury bounce, carrying its structured findings. */
const JURY_FAILED_CAUSE = 'adversarial_review_failed';

/**
 * How far after a bounce its jury row may land and still belong to it. The
 * jury handler records the bounce first and the findings right after; a
 * minute leaves room for a slow DB without reaching the next repair round.
 */
const JURY_ROW_PAIRING_MS = 60_000;

/** Bounce counts per cause in the current repair window. */
export type RepairCauseSummary = Record<RepairCauseKind, number>;

const emptySummary = (): RepairCauseSummary => ({
  capability: 0,
  infrastructure: 0,
  requirements: 0,
  unfounded: 0,
});

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Count this task's repair bounces by cause, since the latest repair-window
 * reset (manual retry, criteria change, answered question, replan) — the same
 * window the repair budget uses, so a replanned task starts clean.
 *
 * Fails open to all-zero: an unreadable history must never block routing, and
 * zero is the pre-existing behaviour (no escalation from bounces).
 *
 * @param taskId - Task being routed / ルーティング対象タスク
 * @returns Bounce counts per cause / 原因別の差し戻し回数
 */
export async function summarizeRepairCauses(taskId: number): Promise<RepairCauseSummary> {
  const summary = emptySummary();
  try {
    const windowStart = await resolveRepairWindowStart(taskId);
    const rows = await prisma.workflowTransition.findMany({
      where: {
        taskId,
        cause: { in: [REPAIR_CAUSE, JURY_FAILED_CAUSE] },
        ...(windowStart ? { createdAt: { gt: windowStart } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { cause: true, metadata: true, createdAt: true },
    });
    const sorted = [...rows].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    sorted.forEach((row, i) => {
      if (row.cause !== REPAIR_CAUSE) return;
      const meta = parseMetadata(row.metadata);
      const bouncedAt = new Date(row.createdAt).getTime();
      // The jury row for THIS bounce is the very next row, if it is a jury
      // row and close in time (a jury row recorded without a bounce — the
      // recovery-blocked path — must not lend its findings to an older one).
      const next = sorted[i + 1];
      const paired =
        next?.cause === JURY_FAILED_CAUSE &&
        new Date(next.createdAt).getTime() - bouncedAt <= JURY_ROW_PAIRING_MS;
      const stored = paired ? parseMetadata(next.metadata).findings : undefined;
      const findings = Array.isArray(stored) ? (stored as RepairFindingLike[]) : null;
      const reason = typeof meta.reason === 'string' ? meta.reason : '';
      summary[classifyRepairCause({ reason, findings }).kind] += 1;
    });
  } catch (err) {
    log.debug({ err, taskId }, 'repair history unreadable — no bounce escalation');
    return emptySummary();
  }
  return summary;
}
