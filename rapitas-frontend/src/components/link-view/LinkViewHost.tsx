'use client';
/**
 * LinkViewHost
 *
 * Mounts the in-app link pane once, in the app shell, so a link clicked
 * anywhere can dock into it. Renders nothing until a URL is opened, which is
 * also when the Tauri child webview is created — no webview exists while the
 * pane is closed.
 */
import { useCallback, useEffect } from 'react';
import { useLinkViewStore, LINK_VIEW_SPLIT_WIDTH_VW } from '@/stores/link-view-store';
import { openExternalUrl } from '@/utils/tauri';
import { LinkViewPane } from './LinkViewPane';
import { useLinkView } from './useLinkView';

/** The docked link pane, or nothing when no link is open. */
export default function LinkViewHost() {
  const url = useLinkViewStore((s) => s.url);
  const closeLink = useLinkViewStore((s) => s.closeLink);

  // A link the pane cannot take still has to go somewhere. The usual cause is
  // a desktop build made before tauri's `unstable` feature was enabled, where
  // the command simply does not exist — the setting is switchable then, so a
  // silent no-op would look like a broken link rather than a missing rebuild.
  const fallBackToBrowser = useCallback(
    (failed: string) => {
      closeLink();
      void openExternalUrl(failed);
    },
    [closeLink],
  );

  const view = useLinkView(fallBackToBrowser);

  // The store is the source of truth for what is open; the hook owns the
  // webview. Mirroring one into the other keeps every caller — including
  // plain DOM click handlers — able to open a link by setting the store.
  useEffect(() => {
    if (url) view.open(url);
    else view.close();
    // view's callbacks are stable; re-running on them would re-open the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Esc closes the pane, matching the split-view exit the app already has.
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLink();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [url, closeLink]);

  if (!url) return null;

  return (
    <div
      className="fixed right-0 top-0 z-30 h-screen bg-white dark:bg-zinc-900"
      style={{ width: `${LINK_VIEW_SPLIT_WIDTH_VW}vw` }}
    >
      <LinkViewPane
        url={url}
        placeholderRef={view.placeholderRef}
        onClose={closeLink}
        onHistory={view.history}
      />
    </div>
  );
}
