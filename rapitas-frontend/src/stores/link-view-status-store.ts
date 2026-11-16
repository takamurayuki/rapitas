/**
 * link-view-status-store
 *
 * Transient, per-tab state of the in-app browser that must NOT survive a
 * restart: whether a page is loading, the band shown above it (a refused
 * navigation, a blocked download, a slow load), and the "webview epoch" that
 * tells `useLinkView` every webview was destroyed (after clearing browsing
 * data). The tabs themselves live in the persisted `link-view-store`.
 */
import { create } from 'zustand';

/** Why a band is shown above a tab's page. */
export type LinkBandKind =
  | 'navigation-blocked'
  | 'new-window-blocked'
  | 'download-blocked'
  | 'slow-load'
  | 'entry-blocked'
  | 'unavailable';

/** A band above one tab's page. */
export interface LinkBand {
  kind: LinkBandKind;
  /** The URL the band is about; offered to the external browser if http(s). */
  url: string;
}

interface LinkViewStatusState {
  /** When each loading tab started, ms since epoch. / 読み込み開始時刻 */
  loadingSince: Record<string, number>;
  bands: Record<string, LinkBand>;
  /** Bumped when every docked webview has been destroyed. / webview 世代 */
  webviewEpoch: number;
  setLoading: (tabId: string, loading: boolean, now?: number) => void;
  showBand: (tabId: string, band: LinkBand) => void;
  dismissBand: (tabId: string) => void;
  bumpWebviewEpoch: () => void;
}

export const useLinkViewStatusStore = create<LinkViewStatusState>()((set) => ({
  loadingSince: {},
  bands: {},
  webviewEpoch: 0,
  setLoading: (tabId, loading, now = Date.now()) =>
    set((s) => {
      const loadingSince = { ...s.loadingSince };
      if (loading) loadingSince[tabId] = now;
      else delete loadingSince[tabId];
      // A finished load clears the slow-load band it may have raised.
      const bands = { ...s.bands };
      if (!loading && bands[tabId]?.kind === 'slow-load') delete bands[tabId];
      return { loadingSince, bands };
    }),
  showBand: (tabId, band) => set((s) => ({ bands: { ...s.bands, [tabId]: band } })),
  dismissBand: (tabId) =>
    set((s) => {
      if (!s.bands[tabId]) return s;
      const bands = { ...s.bands };
      delete bands[tabId];
      return { bands };
    }),
  bumpWebviewEpoch: () =>
    set((s) => ({ webviewEpoch: s.webviewEpoch + 1, loadingSince: {}, bands: {} })),
}));
