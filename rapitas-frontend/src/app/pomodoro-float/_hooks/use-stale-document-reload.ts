/**
 * useStaleDocumentReload
 *
 * Reloads the Pomodoro float window when the frontend that served its
 * document has been replaced.
 *
 * This window is never destroyed on purpose: `close()` is intercepted and
 * turned into `hide()` because recreating it whites out on this WebView2
 * build, and `focus_pomodoro_float` only does unminimize/show/set_focus. So
 * its document is the longest-lived one in the app, while the dev frontend is
 * restarted on every deploy and at auto-run quiet points, reassigning chunk
 * URLs each time. Measured 2026-10-22: `rapitas.exe` had been up since
 * 2026-10-19 12:45 against a frontend restarted at 01:18 that morning, and
 * pressing 時間管理 showed a window with nothing drawn in it.
 *
 * The backend restarts in the same step, so `/health`'s `uptimeSeconds` dates
 * the pair: record the implied boot time when the document loads, re-read it
 * when the window is shown, and reload if it moved. Deliberately a frontend
 * check — the Rust side could reload on show, but that needs a Tauri rebuild,
 * and the thing being replaced is the frontend.
 *
 * Not responsible for the main window, which goes stale the same way (#1085).
 */
'use client';

import { useEffect, useRef } from 'react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('pomodoro-float-stale-reload');

/** Tauri event the Rust side emits when the float window is shown or hidden. */
export const VISIBILITY_EVENT = 'pomodoro-float://visibility-changed';

/**
 * How much the estimated boot time may move before it counts as a restart.
 *
 * `uptimeSeconds` has one-second resolution and the two probes are taken at
 * different moments, so the estimate wobbles by a second or two. Reloading on
 * that would bounce the window on every show.
 */
const JITTER_MS = 10_000;

/** Unsubscribe handle. */
type Unsubscribe = () => void;

/** How the hook learns the window became visible; injectable for tests. */
export interface StaleReloadDeps {
  subscribe?: (event: string, handler: (event: { payload: boolean }) => void) => Unsubscribe;
  healthUrl?: string;
}

/**
 * Read the backend's implied boot time, in this client's own clock.
 *
 * Both sides of the comparison are computed the same way, so a clock offset
 * between client and server cancels out.
 *
 * @param url - Health endpoint / ヘルスエンドポイント
 * @returns Estimated boot time in ms, or null when it cannot be read / 推定起動時刻
 */
async function readBootTime(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { uptimeSeconds?: unknown };
    const uptime = body?.uptimeSeconds;
    if (typeof uptime !== 'number' || !Number.isFinite(uptime) || uptime < 0) return null;
    return Date.now() - uptime * 1000;
  } catch {
    return null;
  }
}

/** Subscribe through Tauri, or do nothing outside it. */
function tauriSubscribe(event: string, handler: (e: { payload: boolean }) => void): Unsubscribe {
  let disposed = false;
  let off: Unsubscribe | null = null;
  void import('@tauri-apps/api/event')
    .then(({ listen }) => listen<boolean>(event, (e) => handler({ payload: e.payload })))
    .then((unlisten) => {
      if (disposed) unlisten();
      else off = unlisten;
    })
    .catch(() => {
      /* not in Tauri, or the chunk is already gone — nothing to subscribe to */
    });
  return () => {
    disposed = true;
    off?.();
  };
}

/**
 * Reload this window on show when the frontend behind it has been replaced.
 *
 * @param deps - Test seams for the event source and health URL / テスト用の差し替え
 */
export function useStaleDocumentReload(deps: StaleReloadDeps = {}): void {
  const { subscribe = tauriSubscribe, healthUrl = 'http://127.0.0.1:3001/health' } = deps;
  const bootTimeAtLoad = useRef<number | null>(null);
  // Once per document: a reload that re-armed itself on a window whose probe
  // keeps answering "new boot" would spin the webview forever.
  const reloaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void readBootTime(healthUrl).then((at) => {
      if (!cancelled) bootTimeAtLoad.current = at;
    });
    return () => {
      cancelled = true;
    };
  }, [healthUrl]);

  useEffect(() => {
    const onVisibility = (e: { payload: boolean }) => {
      if (!e.payload || reloaded.current) return;
      const baseline = bootTimeAtLoad.current;
      // No baseline means the mount-time probe failed; reloading would be a
      // guess, and a guess here costs the window's state for nothing.
      if (baseline === null) return;
      void readBootTime(healthUrl).then((now) => {
        if (now === null || reloaded.current) return;
        if (now - baseline <= JITTER_MS) return;
        reloaded.current = true;
        logger.info('Frontend was replaced while this window was hidden — reloading');
        location.reload();
      });
    };
    return subscribe(VISIBILITY_EVENT, onVisibility);
  }, [subscribe, healthUrl]);
}
