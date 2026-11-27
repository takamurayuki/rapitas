/**
 * goal-insights-ledger
 *
 * The ledger of milestones that have ever been reached, and which of them had
 * their reach undone. Pure; the quality metric itself lives in goal-insights.
 */

/** A recorded reach cancellation (TimelineEvent `milestone_reopened`). */
export interface ReopenRecord {
  milestoneId: number;
  /** ISO time the milestone had been reached before it was undone, if known. */
  reachedAt: string | null;
}

/** One milestone that has been reached at some point. */
export interface LedgerEntry {
  reachedAt: Date | null;
  reopened: boolean;
}

/**
 * List every milestone that has been reached at some point, flagging the ones
 * whose reach was later undone (a `milestone_reopened` record exists).
 *
 * @param milestones - A scope's milestones / 節目
 * @param reopens - Recorded cancellations / 取り消しの記録
 * @returns One entry per ever-reached milestone / 到達台帳
 */
export function buildReachedLedger(
  milestones: ReadonlyArray<{ id: number; status: string; reachedAt: Date | null }>,
  reopens: ReadonlyArray<ReopenRecord>,
): LedgerEntry[] {
  const earliest = new Map<number, Date | null>();
  for (const r of reopens) {
    const at = r.reachedAt ? new Date(r.reachedAt) : null;
    const prev = earliest.get(r.milestoneId);
    if (prev === undefined || (at && (!prev || at < prev))) earliest.set(r.milestoneId, at);
  }
  const ledger: LedgerEntry[] = [];
  for (const m of milestones) {
    const wasReopened = earliest.has(m.id);
    if (m.status === 'reached') ledger.push({ reachedAt: m.reachedAt, reopened: wasReopened });
    else if (wasReopened) ledger.push({ reachedAt: earliest.get(m.id) ?? null, reopened: true });
  }
  return ledger;
}
