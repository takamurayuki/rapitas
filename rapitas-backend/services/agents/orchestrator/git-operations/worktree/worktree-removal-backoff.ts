/**
 * worktree-removal-backoff
 *
 * Bounds how often the same worktree may be re-attempted for removal after a
 * refusal. Owns only that cooldown: it never decides whether a worktree is
 * removable, never removes anything, and never overrides the keep-list.
 *
 * Why. cleanupStaleWorktrees runs on every worker (re)initialization, and
 * workers respawn routinely. Each run walks every worktree under .worktrees/ and
 * re-attempts removal of the ones it does not keep — including those it can
 * never remove, because they hold uncommitted work, have lost their git
 * metadata, or are held by an open handle. Those conditions are persistent, so
 * the attempt fails identically every time.
 *
 * Measured 2026-10-06 over 50 minutes of backend log: 437 of 545 lines were
 * worktree operations, 423 of them inside a single 894-second burst — 158
 * "removeWorktree refused or failed", 86 "missing git metadata", 82 "preserving
 * uncommitted work", 73 "setup-worktree.cjs not found", across 66 registered
 * worktrees. Five of the six event-loop stalls that hour (2.1–4.9 s each) fell
 * inside that burst: 0.34 stalls/min during it against 0.03/min outside, a 12×
 * difference. Each attempt spawns git subprocesses and walks directories, so the
 * cost is paid in event-loop responsiveness.
 *
 * The cooldown is deliberately not permanent. "Uncommitted work" becomes
 * removable the moment someone commits it, so a worktree parked here is retried
 * once the window passes — this reduces the rate, it does not strand anything.
 */

/**
 * How long a refused worktree is skipped before the next attempt. Long enough
 * that repeated worker respawns cost nothing, short enough that a worktree
 * whose blocker was cleared is picked up within the hour.
 */
export const REMOVAL_RETRY_COOLDOWN_MS = 30 * 60 * 1000;

/** Last refusal time per normalized worktree path. */
const refusedAt = new Map<string, number>();

/**
 * Whether removal of this worktree should be skipped for now.
 *
 * Fails toward ATTEMPTING: an unknown path is never skipped, so the backoff can
 * only ever reduce retries of a KNOWN failure, never block a first attempt.
 *
 * @param worktreePath - Normalized worktree path. / 正規化済みのworktreeパス
 * @param nowMs - Current time, injected for tests. / 現在時刻
 * @returns true when the attempt should be skipped. / 試行を省略すべきなら true
 */
export function shouldSkipRemovalAttempt(
  worktreePath: string,
  nowMs: number = Date.now(),
): boolean {
  const last = refusedAt.get(worktreePath);
  if (last === undefined) return false;
  if (nowMs - last < REMOVAL_RETRY_COOLDOWN_MS) return true;
  // Window passed — forget it so the next refusal starts a fresh window.
  refusedAt.delete(worktreePath);
  return false;
}

/**
 * Record that removal was refused or failed for this worktree.
 *
 * @param worktreePath - Normalized worktree path. / 正規化済みのworktreeパス
 * @param nowMs - Current time, injected for tests. / 現在時刻
 */
export function recordRemovalRefused(worktreePath: string, nowMs: number = Date.now()): void {
  refusedAt.set(worktreePath, nowMs);
}

/**
 * Forget any refusal for this worktree — removal succeeded, or the path is gone.
 *
 * @param worktreePath - Normalized worktree path. / 正規化済みのworktreeパス
 */
export function clearRemovalRefusal(worktreePath: string): void {
  refusedAt.delete(worktreePath);
}

/** How many worktrees are currently parked, for the sweep's summary log. */
export function parkedRemovalCount(): number {
  return refusedAt.size;
}

/** Clears the tracker. Test-only — never call from production code. */
export function resetRemovalBackoff(): void {
  refusedAt.clear();
}
