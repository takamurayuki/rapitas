/**
 * briefing-decision-picker
 *
 * Deterministically picks the single item that needs a human decision.
 * Does NOT fetch candidates — the collect layer supplies them.
 */
import type { DecisionCandidate } from './briefing-types';

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function rank(priority: string): number {
  return PRIORITY_RANK[priority] ?? 4;
}

/**
 * Pick at most one candidate: priority (high first) → due date (earliest,
 * none last) → blocking count (most first) → id ascending as the tie-break.
 *
 * @param candidates - Decision candidates / 判断候補
 * @returns The chosen candidate or null when empty / 選ばれた1件または null
 */
export function pickDecision(candidates: DecisionCandidate[]): DecisionCandidate | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const p = rank(a.priority) - rank(b.priority);
    if (p !== 0) return p;
    if (a.dueDate !== b.dueDate) {
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      const d = Date.parse(a.dueDate) - Date.parse(b.dueDate);
      if (d !== 0 && !Number.isNaN(d)) return d;
    }
    const blk = b.blockingCount - a.blockingCount;
    if (blk !== 0) return blk;
    return a.id - b.id;
  });
  return sorted[0];
}
