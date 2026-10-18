'use client';
/**
 * useLinkView
 *
 * Keeps one Tauri child webview per open tab aligned with the pane, and
 * shows only the active one. The webview is an OS surface laid over the
 * window, so nothing keeps it on the pane unless this hook measures the
 * placeholder and pushes the rectangle down on every change.
 *
 * One webview per tab rather than one navigated between them: switching
 * would otherwise reload the page and lose scroll position, which is most
 * of what a tab is for.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  closeLinkView,
  linkViewHistory,
  openLinkView,
  setLinkViewBounds,
  setLinkViewVisible,
  type LinkViewBounds,
} from '@/utils/link-view';
import type { LinkTab } from '@/stores/link-view-store';

/** What the pane needs from this hook. */
export interface UseLinkViewReturn {
  /** Attach to the element the active webview should fill. / 矩形の基準要素 */
  placeholderRef: React.RefObject<HTMLDivElement | null>;
  /** Move history or reload the active tab. / 履歴操作 */
  history: (action: 'back' | 'forward' | 'reload') => void;
  /**
   * Put the active webview back on the pane after a move the observers
   * cannot see — a dock-side swap changes position, not size, and a
   * ResizeObserver never fires for that. / 位置だけ変わった時の再同期
   */
  resync: () => void;
}

/** Read an element's position in CSS pixels relative to the window. */
function boundsOf(el: HTMLElement): LinkViewBounds {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/**
 * Remove a tab's webview from the screen and then destroy it.
 *
 * Hiding first is not redundant. A child webview is an OS surface, and the
 * reported failure was the page staying painted after its tab closed
 * (#1068) — the chrome went, the content did not. Hiding is the step that
 * is certain to take it off screen; closing then releases it.
 *
 * @param tabId - The tab being torn down / 破棄するタブ
 */
async function teardownTab(tabId: string): Promise<void> {
  await setLinkViewVisible(tabId, false);
  await closeLinkView(tabId);
}

/** Two rectangles close enough that moving the webview would be a no-op. */
function sameBounds(a: LinkViewBounds | null, b: LinkViewBounds): boolean {
  if (!a) return false;
  return (
    Math.abs(a.x - b.x) < 1 &&
    Math.abs(a.y - b.y) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1
  );
}

/**
 * Drive the docked webviews for a set of tabs.
 *
 * @param tabs - Every open tab, in display order / 開いているタブ
 * @param activeId - The tab on screen / 表示中のタブ
 * @param onUnavailable - Called with a URL that could not be docked, so the
 *   caller can send it elsewhere / ドックできなかった時の退避先
 * @returns The placeholder ref and history control / 配置基準と履歴操作
 */
export function useLinkView(
  tabs: LinkTab[],
  activeId: string | null,
  onUnavailable?: (url: string) => void,
): UseLinkViewReturn {
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const lastBounds = useRef<LinkViewBounds | null>(null);
  /**
   * The URL each created webview was last pointed at. Keyed rather than a
   * plain Set so editing the address bar can be told apart from a re-render
   * — the first must navigate, the second must not.
   */
  const opened = useRef<Map<string, string>>(new Map());

  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  /**
   * The tab the pane is showing, read at the moment a sync actually runs.
   *
   * `syncBounds` used to close over `activeId`, and `resync` defers a second
   * pass to the next frame — so a pass scheduled while a tab was alive could
   * land after it was torn down and call `setLinkViewVisible(id, true)`,
   * putting the page back on screen at the pane's NEW rectangle. That is the
   * "the ✕ moves it instead of closing it" report (#1076).
   */
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;

  /** The deferred pass, so it can be cancelled before it outlives its state. */
  const pendingFrame = useRef<number | null>(null);

  const syncBounds = useCallback((force = false) => {
    const el = placeholderRef.current;
    // Read the current tab, never a captured one: a deferred pass must act
    // on what is open now, not on what was open when it was scheduled.
    const id = activeIdRef.current;
    if (!el || !id) return;
    // A tab that has been torn down must never be shown again by a sync
    // that was already in flight.
    if (!opened.current.has(id)) return;

    const next = boundsOf(el);
    // A collapsed box means the pane is not on screen — hide rather than
    // shrink, because a 0-sized webview is rejected by the platform and a
    // 1px one would still paint over the page.
    if (next.width < 2 || next.height < 2) {
      void setLinkViewVisible(id, false);
      lastBounds.current = null;
      return;
    }
    if (!force && sameBounds(lastBounds.current, next)) return;
    lastBounds.current = next;
    void setLinkViewBounds(id, next);
    void setLinkViewVisible(id, true);
  }, []);

  /** Drop a deferred pass that has not run yet. */
  const cancelPending = useCallback(() => {
    if (pendingFrame.current !== null) {
      cancelAnimationFrame(pendingFrame.current);
      pendingFrame.current = null;
    }
  }, []);

  // The pane may not have been laid out at its new place yet when the side
  // changes, so measure again on the next frame rather than this one. Only
  // one such pass is ever outstanding, and it is cancelled rather than left
  // to fire against state it no longer matches.
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
      if (activeId) void linkViewHistory(activeId, action);
    },
    [activeId],
  );

  // Create the active tab's webview the first time it is shown, and move it
  // onto the pane. Re-running on activeId alone is deliberate: a tab that
  // was already opened keeps its page.
  useEffect(() => {
    if (!activeId) return;
    const tab = tabs.find((candidate) => candidate.id === activeId);
    const el = placeholderRef.current;
    if (!tab || !el) return;

    const bounds = boundsOf(el);
    lastBounds.current = bounds;

    if (opened.current.has(tab.id)) {
      void setLinkViewBounds(tab.id, bounds);
      void setLinkViewVisible(tab.id, true);
      return;
    }

    opened.current.set(tab.id, tab.url);
    let cancelled = false;
    void openLinkView(tab.id, tab.url, bounds).then((docked) => {
      // The command is absent until the desktop app is rebuilt with tauri's
      // `unstable` feature, so a user who picks the in-app pane before that
      // rebuild would otherwise click a link and watch nothing happen.
      if (!docked && !cancelled) {
        opened.current.delete(tab.id);
        onUnavailableRef.current?.(tab.url);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Navigate when the address bar points a tab somewhere else. The docking
  // effect above keys on activeId alone — deliberately, so returning to a
  // tab does not reload it — so a URL change needs its own trigger.
  useEffect(() => {
    if (!activeId) return;
    const tab = tabs.find((candidate) => candidate.id === activeId);
    const el = placeholderRef.current;
    if (!tab || !el) return;
    const shown = opened.current.get(tab.id);
    if (shown === undefined || shown === tab.url) return;
    opened.current.set(tab.id, tab.url);
    void openLinkView(tab.id, tab.url, boundsOf(el));
  }, [tabs, activeId]);

  // Only the active tab is on screen; the rest stay built and hidden so
  // their pages survive a switch.
  useEffect(() => {
    for (const tab of tabs) {
      if (tab.id !== activeId && opened.current.has(tab.id)) {
        void setLinkViewVisible(tab.id, false);
      }
    }
  }, [tabs, activeId]);

  // Destroy the webview of any tab that has gone.
  useEffect(() => {
    const live = new Set(tabs.map((tab) => tab.id));
    for (const id of Array.from(opened.current.keys())) {
      if (!live.has(id)) {
        // Before the webview goes, drop any deferred sync that could still
        // fire and put it back on screen.
        cancelPending();
        opened.current.delete(id);
        void teardownTab(id);
      }
    }
  }, [tabs, cancelPending]);

  // Keep the surface on the pane. ResizeObserver catches layout changes the
  // window-level events miss — a sibling panel opening, the nav pinning.
  useEffect(() => {
    if (!activeId) return;
    const el = placeholderRef.current;
    if (!el) return;

    // Guarded like TaskDetailQuickNav: jsdom has no ResizeObserver, and the
    // window listeners below already cover the common case without it.
    const onChange = () => syncBounds();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onChange);
    observer?.observe(el);
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  }, [activeId, syncBounds]);

  // The webviews outlive React unless told otherwise: nothing destroys an OS
  // surface when the component that asked for it unmounts.
  useEffect(() => {
    const createdTabs = opened.current;
    return () => {
      cancelPending();
      for (const id of Array.from(createdTabs.keys())) void teardownTab(id);
      createdTabs.clear();
    };
    // cancelPending is a stable useCallback([]); listing it keeps the rule
    // satisfied without changing when this runs.
  }, [cancelPending]);

  return { placeholderRef, history, resync };
}
