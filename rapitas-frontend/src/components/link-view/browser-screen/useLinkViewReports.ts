'use client';
/**
 * useLinkViewReports
 *
 * Turns what the docked webviews report into app state: load progress (and
 * the slow-load band after 20 s), refused navigations and downloads (bands),
 * and `window.open` requests (a new tab via the store, which re-checks the
 * URL). Mounted once, by LinkViewHost.
 *
 * Page-supplied values are only ever used as a URL to open after the policy
 * check, or shown as text — never interpreted (nav60 §5.1).
 */
import { useEffect } from 'react';
import { onLinkViewEvent, type LinkViewTabEvent } from '@/utils/link-view-events';
import { useLinkViewStatusStore } from '@/stores/link-view-status-store';
import { useLinkViewStore } from '@/stores/link-view-store';
import { canOpenInBrowser } from '@/utils/browser-url-policy';

/** How long a load may run before the "taking a while" band appears. */
export const SLOW_LOAD_MS = 20_000;

/** Subscribe to the docked webviews' reports for as long as the host lives. */
export function useLinkViewReports(): void {
  useEffect(() => {
    const status = useLinkViewStatusStore.getState();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const stops: Array<() => void> = [];
    let cancelled = false;

    const clearTimer = (tabId: string) => {
      const timer = timers.get(tabId);
      if (timer) clearTimeout(timer);
      timers.delete(tabId);
    };

    const handlers: Array<[Parameters<typeof onLinkViewEvent>[0], (e: LinkViewTabEvent) => void]> =
      [
        [
          'loadState',
          (e) => {
            const loading = e.detail === 'started';
            status.setLoading(e.tabId, loading);
            clearTimer(e.tabId);
            if (loading) {
              timers.set(
                e.tabId,
                setTimeout(() => {
                  if (useLinkViewStatusStore.getState().loadingSince[e.tabId] !== undefined) {
                    status.showBand(e.tabId, { kind: 'slow-load', url: e.url });
                  }
                }, SLOW_LOAD_MS),
              );
            }
          },
        ],
        [
          'navigationBlocked',
          (e) => status.showBand(e.tabId, { kind: 'navigation-blocked', url: e.url }),
        ],
        [
          'newWindowBlocked',
          (e) => status.showBand(e.tabId, { kind: 'new-window-blocked', url: e.url }),
        ],
        [
          'downloadBlocked',
          (e) => status.showBand(e.tabId, { kind: 'download-blocked', url: e.url }),
        ],
        [
          'newWindow',
          (e) => {
            // Re-checked here as well as in Rust: the store refuses it anyway,
            // but a refusal should say so on the tab that asked.
            if (!canOpenInBrowser(e.url)) {
              status.showBand(e.tabId, { kind: 'new-window-blocked', url: e.url });
              return;
            }
            useLinkViewStore.getState().openLink(e.url);
          },
        ],
      ];

    for (const [name, handler] of handlers) {
      void onLinkViewEvent(name, handler).then((stop) => {
        if (cancelled) stop();
        else stops.push(stop);
      });
    }
    return () => {
      cancelled = true;
      for (const stop of stops) stop();
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);
}
