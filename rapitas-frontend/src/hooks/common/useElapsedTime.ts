/**
 * useElapsedTime
 *
 * Ticks a live "elapsed since start" display for a running process (e.g. an
 * executing agent). Runs a single interval while `active` is true and cleans
 * it up on unmount or when tracking stops, so callers only pay the per-second
 * re-render cost while something is actually running.
 */

'use client';

import { useEffect, useState } from 'react';

/**
 * Format a millisecond duration as a compact clock string.
 *
 * @param ms - Elapsed milliseconds / 経過ミリ秒
 * @returns "M:SS" under an hour, "H:MM:SS" past it / 表示用の経過時間文字列
 */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * Live-ticking elapsed-time string since `startedAt`, plus an optional
 * cumulative base offset.
 *
 * With `baseOffsetMs` the display renders `base + (now - startedAt)`: the base
 * carries the task's finished active time across phase / re-run boundaries so
 * the timer accumulates monotonically instead of resetting to 0 when a new
 * execution row (= new startedAt) appears (task #560).
 *
 * @param startedAt - ISO timestamp the tracked process began, or null/undefined when unknown / 開始時刻
 * @param active - Whether to keep ticking; the interval is torn down when this is false / 計測を継続するか
 * @param baseOffsetMs - Cumulative finished active time added to the live elapsed / 累積実働ms（省略時0）
 * @returns Compact elapsed string (e.g. "3:21"); static base when not ticking but base > 0; null otherwise / 経過時間 or null
 */
export function useElapsedTime(
  startedAt: string | null | undefined,
  active: boolean,
  baseOffsetMs: number = 0,
): string | null {
  // Re-render tick — the displayed value is recomputed from Date.now() below,
  // this state only exists to force that recomputation once per second.
  const [, tick] = useState(0);

  useEffect(() => {
    if (!active || !startedAt) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active, startedAt]);

  const base = Number.isFinite(baseOffsetMs) && baseOffsetMs > 0 ? baseOffsetMs : 0;
  if (!active || !startedAt) {
    // Not ticking, but the task has accumulated active time (e.g. between
    // phases, or a waiting card) — show the static cumulative value instead of
    // dropping to nothing and "resetting" on the next phase.
    return base > 0 ? formatElapsed(base) : null;
  }
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return base > 0 ? formatElapsed(base) : null;
  return formatElapsed(base + Math.max(0, Date.now() - start));
}
