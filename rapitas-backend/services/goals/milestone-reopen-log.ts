/**
 * milestone-reopen-log
 *
 * Builds the TimelineEvent row that records a milestone's reach being undone,
 * so outcome quality can count cancellations without a schema change.
 * Not responsible for writing it — routes do that in the same transaction as the update.
 */

/** TimelineEvent.eventType for an undone reach. */
export const MILESTONE_REOPENED_EVENT = 'milestone_reopened';

/**
 * Row data for a `milestone_reopened` TimelineEvent.
 *
 * @param milestone - The milestone being reopened, as stored before the update / 取り消す節目
 * @returns Data for `prisma.timelineEvent.create` / 記録する行
 */
export function milestoneReopenedEvent(milestone: { id: number; reachedAt: Date | null }) {
  return {
    eventType: MILESTONE_REOPENED_EVENT,
    actorType: 'user',
    payload: JSON.stringify({
      milestoneId: milestone.id,
      reachedAt: milestone.reachedAt ? milestone.reachedAt.toISOString() : null,
    }),
    correlationId: `milestone:${milestone.id}`,
  };
}
