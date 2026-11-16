'use client';
/**
 * useLinkView
 *
 * Keeps one Tauri child webview per open tab aligned with the surface it is
 * drawn on — the side pane or the /browser screen — and decides, in ONE
 * place, which of them is on screen.
 *
 * Visibility rule (nav60 §3.1): a tab's webview is shown only when it is the
 * shown tab, the surface element is attached and has a box, its rectangle has
 * been sent for THAT element, and no HTML overlay is registered in
 * `webview-occlusion-store`. `applyVisibility` is the only caller of
 * `setLinkViewVisible`; every other step (bounds sync, tab switch, creation,
 * a command finishing, a tab closing, the host unmounting) just calls it
 * again. Each decision carries a sequence number the Rust side uses to drop
 * stale commands.
 *
 * Owned once, by LinkViewHost: unmounting destroys every webview, so a second
 * owner would reload pages whenever the layout switched.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  closeLinkView,
  linkViewHistory,
  onLinkViewPageChanged,
  openLinkView,
  setLinkViewBounds,
  setLinkViewVisible,
  type LinkViewBounds,
} from '@/utils/link-view';
import { useWebviewOcclusionStore } from '@/stores/webview-occlusion-store';
import { useLinkViewStatusStore } from '@/stores/link-view-status-store';
import { boundsOf, isCollapsed, nextVisibilitySeq, sameBounds } from './link-view-geometry';
import type { LinkPageChange } from './link-tab-meta';
import type { LinkTab } from '@/stores/link-view-store';

/** What the host needs from this hook. */
export interface UseLinkViewReturn {
  /** Move history or reload the shown tab. / 履歴操作 */
  history: (action: 'back' | 'forward' | 'reload') => void;
  /**
   * Re-measure after a move the observers cannot see — a dock-side swap
   * changes position, not size. / 位置だけ変わった時の再同期
   */
  resync: () => void;
}

/**
 * Drive the docked webviews for a set of tabs.
 *
 * @param tabs - Every open tab, in display order / 開いているタブ
 * @param shownId - The tab whose page is on screen, or null / 表示中のタブ
 * @param surface - The element the page is drawn over (pane or screen) / 表示先の要素
 * @param onUnavailable - Called with a URL that could not be docked / ドックできなかった時
 * @param onPageChange - Called when a webview reports where it went / webview 側の遷移
 * @returns History control and a resync trigger / 履歴操作と再同期
 */
export function useLinkView(
  tabs: LinkTab[],
  shownId: string | null,
  surface: HTMLElement | null,
  onUnavailable?: (url: string) => void,
  onPageChange?: (tabId: string, change: LinkPageChange) => void,
): UseLinkViewReturn {
  /** The URL each created (or creating) webview was last pointed at. */
  const opened = useRef<Map<string, string>>(new Map());
  /** Tabs whose `open_link_webview` has completed — only these can show. */
  const created = useRef<Set<string>>(new Set());
  /** The last visibility sent per tab, so unchanged decisions are not resent. */
  const lastSent = useRef<Map<string, boolean>>(new Map());
  /** The rectangle confirmed for (tab, element); null until sent. */
  const placed = useRef<{ tabId: string; el: HTMLElement; bounds: LinkViewBounds } | null>(null);
  const pendingFrame = useRef<number | null>(null);
  /** Webviews whose tab has gone: the next pass hides, then closes them. */
  const retiring = useRef<Set<string>>(new Set());

  const occluded = useWebviewOcclusionStore((s) => s.occluders.length > 0);
  const epoch = useLinkViewStatusStore((s) => s.webviewEpoch);

  // Read at the moment a pass runs, never captured: an async completion must
  // act on what is true now (#1076 — a deferred pass resurrected a closed tab).
  const live = useRef({ shownId, surface, occluded });
  live.current = { shownId, surface, occluded };

  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;

  const applyVisibility = useCallback(() => {
    const { shownId: id, surface: el, occluded: covered } = live.current;
    const box = el && el.isConnected ? boundsOf(el) : null;
    const surfaceReady = Boolean(box && !isCollapsed(box));
    for (const tabId of Array.from(opened.current.keys())) {
      const want =
        tabId === id &&
        surfaceReady &&
        !covered &&
        created.current.has(tabId) &&
        placed.current?.tabId === tabId &&
        placed.current.el === el;
      if (lastSent.current.get(tabId) === want) continue;
      lastSent.current.set(tabId, want);
      void setLinkViewVisible(tabId, want, nextVisibilitySeq()).then((ok) => {
        // A refused command is retried by the next pass with a new number.
        if (!ok) lastSent.current.delete(tabId);
      });
    }
    // NOTE: Closing goes through here too (it used to send its own hide), so
    // the final hide is ordered with every other command. Hidden before it
    // is closed — the surface staying painted after its tab closed was #1068.
    for (const tabId of Array.from(retiring.current)) {
      retiring.current.delete(tabId);
      void setLinkViewVisible(tabId, false, nextVisibilitySeq()).then(() => closeLinkView(tabId));
    }
  }, []);

  const syncBounds = useCallback(
    (force = false) => {
      const { shownId: id, surface: el } = live.current;
      if (!el || !id || !opened.current.has(id)) return;
      const next = boundsOf(el);
      if (isCollapsed(next)) {
        // Hide rather than shrink: a 0-sized webview is rejected and a 1px
        // one would still paint over the page.
        placed.current = null;
        applyVisibility();
        return;
      }
      const current = placed.current;
      if (
        !force &&
        current?.tabId === id &&
        current.el === el &&
        sameBounds(current.bounds, next)
      ) {
        return;
      }
      void setLinkViewBounds(id, next).then(() => {
        const now = live.current;
        if (now.shownId !== id || now.surface !== el) return;
        placed.current = { tabId: id, el, bounds: next };
        applyVisibility();
      });
    },
    [applyVisibility],
  );

  const cancelPending = useCallback(() => {
    if (pendingFrame.current !== null) {
      cancelAnimationFrame(pendingFrame.current);
      pendingFrame.current = null;
    }
  }, []);

  // The pane may not be laid out at its new place yet, so measure again on
  // the next frame. Only one such pass is outstanding at a time.
  const resync = useCallback(() => {
    syncBounds(true);
    cancelPending();
    pendingFrame.current = requestAnimationFrame(() => {
      pendingFrame.current = null;
      syncBounds(true);
    });
  }, [syncBounds, cancelPending]);

  const history = useCallback(
    (action: 'back' | 'forward' | 'reload') => {
      if (shownId) void linkViewHistory(shownId, action);
    },
    [shownId],
  );

  // Every webview was destroyed (browsing data cleared): forget them, so the
  // shown tab is rebuilt from its URL by the effect keyed on `epoch`
  // below. Declared first so it runs before that effect on the same commit.
  useEffect(() => {
    if (epoch === 0) return;
    opened.current.clear();
    created.current.clear();
    lastSent.current.clear();
    placed.current = null;
  }, [epoch]);

  // A different tab or a different surface: hide first (the old rectangle
  // must never flash), then create or re-place, then decide again.
  useEffect(() => {
    placed.current = null;
    applyVisibility();
    if (!shownId || !surface) return;
    const tab = tabs.find((candidate) => candidate.id === shownId);
    if (!tab) return;

    if (opened.current.has(tab.id)) {
      syncBounds(true);
      return;
    }

    opened.current.set(tab.id, tab.url);
    const bounds = boundsOf(surface);
    let cancelled = false;
    void openLinkView(tab.id, tab.url, bounds).then((docked) => {
      if (!docked) {
        opened.current.delete(tab.id);
        // The command is absent on builds made before tauri's `unstable`
        // feature; a silent no-op would look like a broken link.
        if (!cancelled) onUnavailableRef.current?.(tab.url);
        return;
      }
      created.current.add(tab.id);
      // Anything sent before the webview existed was recorded, not shown.
      lastSent.current.delete(tab.id);
      const now = live.current;
      if (now.shownId === tab.id && now.surface === surface) {
        placed.current = { tabId: tab.id, el: surface, bounds };
        // The rectangle may have moved while the webview was being built.
        syncBounds();
      }
      applyVisibility();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId, surface, epoch]);

  // Navigate when the address bar points the shown tab somewhere else. The
  // effect above keys on the tab alone so returning to a tab never reloads.
  useEffect(() => {
    if (!shownId || !surface) return;
    const tab = tabs.find((candidate) => candidate.id === shownId);
    if (!tab) return;
    const shown = opened.current.get(tab.id);
    if (shown === undefined || shown === tab.url) return;
    opened.current.set(tab.id, tab.url);
    void openLinkView(tab.id, tab.url, boundsOf(surface)).then(() => applyVisibility());
  }, [tabs, shownId, surface, applyVisibility]);

  // Follow the page inside the webview (#1078). The URL is recorded in
  // `opened` BEFORE it reaches the store, so folding it back in does not read
  // as an address-bar edit and reload the page.
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void onLinkViewPageChanged((change) => {
      if (!opened.current.has(change.tabId)) return;
      const url = change.url?.trim() || undefined;
      if (url) opened.current.set(change.tabId, url);
      onPageChangeRef.current?.(change.tabId, { url, title: change.title ?? undefined });
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  // An overlay opened or closed.
  useEffect(() => {
    applyVisibility();
  }, [occluded, applyVisibility]);

  // Destroy the webview of any tab that has gone (applyVisibility hides it,
  // then closes it).
  useEffect(() => {
    const liveIds = new Set(tabs.map((tab) => tab.id));
    let gone = false;
    for (const id of Array.from(opened.current.keys())) {
      if (liveIds.has(id)) continue;
      gone = true;
      cancelPending();
      opened.current.delete(id);
      created.current.delete(id);
      lastSent.current.delete(id);
      if (placed.current?.tabId === id) placed.current = null;
      retiring.current.add(id);
    }
    if (gone) applyVisibility();
  }, [tabs, cancelPending, applyVisibility]);

  // Keep the surface's rectangle current. Re-bound whenever the surface
  // element itself changes, so moving between pane and screen observes the
  // new element rather than the detached old one.
  useEffect(() => {
    if (!shownId || !surface) return;
    const onChange = () => syncBounds();
    // Guarded: jsdom has no ResizeObserver; the window listeners cover it.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onChange);
    observer?.observe(surface);
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  }, [shownId, surface, syncBounds]);

  // Nothing destroys an OS surface when the component that asked for it
  // unmounts, so this does.
  useEffect(() => {
    const createdTabs = opened.current;
    const toRetire = retiring.current;
    return () => {
      cancelPending();
      for (const id of Array.from(createdTabs.keys())) toRetire.add(id);
      createdTabs.clear();
      applyVisibility();
    };
  }, [cancelPending, applyVisibility]);

  return { history, resync };
}
