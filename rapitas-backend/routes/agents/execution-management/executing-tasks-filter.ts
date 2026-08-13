/**
 * ExecutingTasksFilter
 *
 * Pure display-freshness predicate for GET /tasks/executing: decides which
 * AgentExecution rows are honest to show as "running" on task cards.
 * Not responsible for correcting stale rows — startup reconcile and the lease
 * sweep (services/agents/orchestrator/stale-execution-recovery.ts) own that.
 */

// NOTE: 5 minutes = 20 missed heartbeats (HEARTBEAT_INTERVAL_MS is 15s).
// Intentionally NOT shared with auto-run-selection's HANG_BACKSTOP_HEARTBEAT_MS:
// same value, different meaning (hang detection vs display freshness), and
// importing it would tangle routes → services/workflow.
export const EXECUTING_DISPLAY_STALE_MS = 5 * 60_000;

/** Session statuses in which a waiting_for_input row can no longer be answered. */
export const TERMINAL_SESSION_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'interrupted',
  'cancelled',
  'acknowledged',
]);

/** Minimal structural shape of an AgentExecution row this filter judges. */
export interface ExecutingRowLike {
  status: string;
  heartbeatAt: Date | null;
  session: { status: string } | null;
}

/**
 * Filters execution rows down to those that are honest to display as executing.
 *
 * @param rows - Candidate rows (status running / waiting_for_input) / 候補行
 * @param now - Reference time for the freshness window (injected for testability) / 鮮度判定の基準時刻
 * @returns Subset of rows safe to display, original order preserved / 表示してよい行の部分集合
 */
export function selectExecutingRows<T extends ExecutingRowLike>(rows: T[], now: Date): T[] {
  const staleFloor = now.getTime() - EXECUTING_DISPLAY_STALE_MS;
  return rows.filter((row) => {
    if (row.status === 'running') {
      // A live agent beats every 15s; null or older-than-window means the
      // owning process is dead (correction is the reconciler's job, not ours).
      return row.heartbeatAt != null && row.heartbeatAt.getTime() >= staleFloor;
    }
    if (row.status === 'waiting_for_input') {
      // Fail-open: a question-wait has no agent process, so its heartbeat is
      // always stale — never judge it by heartbeat, and never by question
      // (timeout-handler legitimately produces question=null waits). Only a
      // terminated session proves nobody can answer anymore.
      const sessionStatus = row.session?.status;
      return sessionStatus == null || !TERMINAL_SESSION_STATUSES.has(sessionStatus);
    }
    return false;
  });
}
