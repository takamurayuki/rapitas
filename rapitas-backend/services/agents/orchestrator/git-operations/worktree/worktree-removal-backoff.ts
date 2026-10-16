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

/**
 * Cap on the grown window. Past this the worktree is retried again, because the
 * cooldown is a rate limit and not a permanent exclusion (see the note above).
 */
export const REMOVAL_MAX_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Factor the window grows by after each consecutive refusal.
 *
 * NOTE: a FIXED window is worthless when it equals the sweep interval, which is
 * exactly what shipped: worktree-cleanup-scheduler's `defaultIntervalMs` is
 * `30 * 60 * 1000` and so was this cooldown, so every sweep arrived the moment
 * the window expired and re-attempted everything. Measured 2026-10-12 over the
 * two hours after a restart: sweeps at 21:00/21:30/22:00/22:30/23:00Z each
 * refused the same 7 worktrees, 80 WARN lines, every one of them
 * `Missing Git metadata` — no `.git`, so `git worktree remove` can never
 * succeed for them. Growing the window decouples it from the sweep period
 * without hard-coding knowledge of that period here.
 */
const REMOVAL_BACKOFF_FACTOR = 2;

/** Last refusal time and consecutive-refusal count per normalized worktree path. */
const refusedAt = new Map<string, { atMs: number; strikes: number }>();

/**
 * The window to wait after `strikes` consecutive refusals.
 *
 * The first refusal keeps the original 30-minute window so a one-off blocker
 * (an open handle, a build still writing) is retried promptly; only a worktree
 * that keeps refusing backs off further.
 *
 * @param strikes - Consecutive refusals, 1-based. / 連続拒否回数(1始まり)
 * @returns Window in ms, capped. / 待機窓(ms、上限あり)
 */
export function removalCooldownMs(strikes: number): number {
  const grown = REMOVAL_RETRY_COOLDOWN_MS * REMOVAL_BACKOFF_FACTOR ** Math.max(0, strikes - 1);
  return Math.min(grown, REMOVAL_MAX_COOLDOWN_MS);
}

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
  if (nowMs - last.atMs < removalCooldownMs(last.strikes)) return true;
  // Window passed — allow the attempt. The strike count is KEPT: dropping it
  // here would reset the growth on every expiry, which is how a fixed window
  // equal to the sweep period produced an attempt on every single sweep.
  // clearRemovalRefusal (removal succeeded) is what resets it.
  return false;
}

/**
 * Record that removal was refused or failed for this worktree.
 *
 * @param worktreePath - Normalized worktree path. / 正規化済みのworktreeパス
 * @param nowMs - Current time, injected for tests. / 現在時刻
 */
export function recordRemovalRefused(worktreePath: string, nowMs: number = Date.now()): void {
  const strikes = (refusedAt.get(worktreePath)?.strikes ?? 0) + 1;
  refusedAt.set(worktreePath, { atMs: nowMs, strikes });
}

/**
 * Forget any refusal for this worktree — removal succeeded, or the path is gone.
 *
 * @param worktreePath - Normalized worktree path. / 正規化済みのworktreeパス
 */
export function clearRemovalRefusal(worktreePath: string): void {
  refusedAt.delete(worktreePath);
}

/**
 * How many worktrees are currently parked, for the sweep's summary log.
 *
 * Counts only entries still inside their window. The map itself retains an
 * entry past expiry to keep its strike count (see shouldSkipRemovalAttempt), so
 * `refusedAt.size` would otherwise report retryable worktrees as parked and the
 * summary log would never fall back to zero.
 *
 * @param nowMs - Current time, injected for tests. / 現在時刻
 * @returns Worktrees whose cooldown has not elapsed. / 窓が切れていない件数
 */
export function parkedRemovalCount(nowMs: number = Date.now()): number {
  let n = 0;
  for (const entry of refusedAt.values()) {
    if (nowMs - entry.atMs < removalCooldownMs(entry.strikes)) n += 1;
  }
  return n;
}

/** Clears the tracker. Test-only — never call from production code. */
export function resetRemovalBackoff(): void {
  refusedAt.clear();
}
