/**
 * concern-recurrence-candidates
 *
 * Pure candidate-selection helpers for concern-recurrence-policy.ts's
 * resolveRecurrence (task #857): picking which terminal-row candidate a
 * recurring signature should attach to, independent of Prisma. Not
 * responsible for querying rows or deciding the overall resolution action —
 * concern-recurrence-policy.ts owns that.
 */

/** A candidate row paired with the completedAt of its follow-up task (if any). */
export interface ResolvedCandidate<TRow extends { createdAt: Date }> {
  row: TRow;
  completedAt: Date | null;
}

/**
 * Picks the most recently created candidate whose row was created within
 * `suppressWindowMs` of `nowMs` — a signature that just recurred moments ago
 * should merge into that fresh row instead of spawning a sibling.
 *
 * @param candidates - Resolved terminal-row candidates / 解決済みの終端行候補
 * @param nowMs - Current time (ms) / 現在時刻
 * @param suppressWindowMs - Suppression window in ms / 抑制ウィンドウ(ms)
 * @returns The winning row, or null if none fall within the window / 該当行、無ければnull
 */
export function pickSuppressingCandidate<TRow extends { createdAt: Date }>(
  candidates: readonly ResolvedCandidate<TRow>[],
  nowMs: number,
  suppressWindowMs: number,
): TRow | null {
  let best: ResolvedCandidate<TRow> | null = null;
  for (const candidate of candidates) {
    if (nowMs - candidate.row.createdAt.getTime() > suppressWindowMs) continue;
    if (!best || candidate.row.createdAt.getTime() > best.row.createdAt.getTime()) {
      best = candidate;
    }
  }
  return best ? best.row : null;
}

/**
 * Picks the terminal-row candidate whose follow-up task completed most
 * recently within `windowMs` of `nowMs`. Order-independent — unlike a
 * first-match scan, this always converges on the same row regardless of the
 * order candidates were supplied in.
 *
 * @param candidates - Resolved terminal-row candidates / 解決済みの終端行候補
 * @param nowMs - Current time (ms) / 現在時刻
 * @param windowMs - Recurrence window in ms / 再発判定ウィンドウ(ms)
 * @returns The winning row, or null if none fall within the window / 該当行、無ければnull
 */
export function pickLatestDoneCandidate<TRow extends { createdAt: Date }>(
  candidates: readonly ResolvedCandidate<TRow>[],
  nowMs: number,
  windowMs: number,
): TRow | null {
  let best: ResolvedCandidate<TRow> | null = null;
  for (const candidate of candidates) {
    if (!candidate.completedAt) continue;
    if (nowMs - candidate.completedAt.getTime() > windowMs) continue;
    if (
      !best ||
      !best.completedAt ||
      candidate.completedAt.getTime() > best.completedAt.getTime()
    ) {
      best = candidate;
    }
  }
  return best ? best.row : null;
}
