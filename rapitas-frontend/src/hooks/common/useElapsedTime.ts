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
 * Live-ticking elapsed-time string since `startedAt`.
 *
 * @param startedAt - ISO timestamp the tracked process began, or null/undefined when unknown / 開始時刻
 * @param active - Whether to keep ticking; the interval is torn down when this is false / 計測を継続するか
 * @returns Compact elapsed string (e.g. "3:21"), or null when inactive or start time is unavailable / 経過時間 or null
 */
export function useElapsedTime(
  startedAt: string | null | undefined,
  active: boolean,
): string | null {
  // Re-render tick — the displayed value is recomputed from Date.now() below,
  // this state only exists to force that recomputation once per second.
  const [, tick] = useState(0);

  useEffect(() => {
    if (!active || !startedAt) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active, startedAt]);

  if (!active || !startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  return formatElapsed(Date.now() - start);
}
