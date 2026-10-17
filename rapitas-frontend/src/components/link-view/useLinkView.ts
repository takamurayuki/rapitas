'use client';
/**
 * useLinkView
 *
 * Owns the docked link webview's lifecycle and, more importantly, its
 * rectangle: the webview is an OS surface laid over the window, so nothing
 * keeps it aligned with the pane unless this hook measures the placeholder
 * and pushes the result down on every change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  closeLinkView,
  linkViewHistory,
  openLinkView,
  setLinkViewBounds,
  setLinkViewVisible,
  type LinkViewBounds,
} from '@/utils/link-view';

/** What the pane needs from this hook. */
export interface UseLinkViewReturn {
  /** The URL currently docked, or null when the pane is closed. / 表示中のURL */
  url: string | null;
  /** Attach to the element whose box the webview should fill. / 矩形の基準要素 */
  placeholderRef: React.RefObject<HTMLDivElement | null>;
  /** Dock a URL, opening the pane. / リンクを開く */
  open: (url: string) => void;
  /** Close the pane and destroy the webview. / 閉じる */
  close: () => void;
  /** Move history or reload. / 履歴操作 */
  history: (action: 'back' | 'forward' | 'reload') => void;
}

/** Read an element's position in CSS pixels relative to the window. */
function boundsOf(el: HTMLElement): LinkViewBounds {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
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
 * Drives the docked link webview.
 *
 * @param onUnavailable - Called with the URL when it could not be docked, so
 *   the caller can send it somewhere else / ドックできなかった時の退避先
 * @returns The pane's state and controls / ペインの状態と操作
 */
export function useLinkView(onUnavailable?: (url: string) => void): UseLinkViewReturn {
  const [url, setUrl] = useState<string | null>(null);
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const lastBounds = useRef<LinkViewBounds | null>(null);

  // Held in a ref so a caller passing an inline callback does not re-run the
  // docking effect — that would reload the page on every render.
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  const syncBounds = useCallback(() => {
    const el = placeholderRef.current;
    if (!el || !url) return;
    const next = boundsOf(el);
    // A collapsed box means the pane is not on screen — hide rather than
    // shrink, because a 0-sized webview is rejected by the platform and a
    // 1px one would still paint over the page.
    if (next.width < 2 || next.height < 2) {
      void setLinkViewVisible(false);
      lastBounds.current = null;
      return;
    }
    if (sameBounds(lastBounds.current, next)) return;
    lastBounds.current = next;
    void setLinkViewBounds(next);
    void setLinkViewVisible(true);
  }, [url]);

  const open = useCallback((next: string) => {
    setUrl(next);
  }, []);

  const close = useCallback(() => {
    setUrl(null);
    lastBounds.current = null;
    void closeLinkView();
  }, []);

  const history = useCallback((action: 'back' | 'forward' | 'reload') => {
    void linkViewHistory(action);
  }, []);

  // Dock the URL once the placeholder has a box to measure. Re-running on
  // `url` alone is deliberate: a second link reuses the same webview so its
  // back history survives.
  useEffect(() => {
    if (!url) return;
    const el = placeholderRef.current;
    if (!el) return;
    const bounds = boundsOf(el);
    lastBounds.current = bounds;

    let cancelled = false;
    void openLinkView(url, bounds).then((docked) => {
      // The command is absent until the desktop app is rebuilt with tauri's
      // `unstable` feature, so a user who picks the in-app pane before that
      // rebuild would otherwise click a link and watch nothing happen.
      if (!docked && !cancelled) onUnavailableRef.current?.(url);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Keep the surface on the pane. ResizeObserver catches layout changes the
  // window-level events miss — a sibling panel collapsing, the nav pinning.
  useEffect(() => {
    if (!url) return;
    const el = placeholderRef.current;
    if (!el) return;

    // Guarded like TaskDetailQuickNav: jsdom has no ResizeObserver, and the
    // window listeners below already cover the common case without it.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncBounds);
    observer?.observe(el);
    window.addEventListener('resize', syncBounds);
    window.addEventListener('scroll', syncBounds, true);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', syncBounds);
      window.removeEventListener('scroll', syncBounds, true);
    };
  }, [url, syncBounds]);

  // The webview outlives React unless it is told otherwise: nothing destroys
  // an OS surface when the component that asked for it unmounts.
  useEffect(() => {
    return () => {
      void closeLinkView();
    };
  }, []);

  return { url, placeholderRef, open, close, history };
}
