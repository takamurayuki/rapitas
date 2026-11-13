'use client';
/**
 * LinkViewHost
 *
 * The in-app browser's single owner, mounted once in the app shell: it holds
 * the docked webviews (through `useLinkView`) and decides which layout shows
 * them — the side pane, or, on /browser, the full screen portalled into the
 * page's slot. One owner because the webviews are destroyed with it; a second
 * owner on /browser would reload every page on each switch (nav60 §3.1).
 *
 * Placement is decided here rather than in the pane: the pane draws, the
 * host decides which edge it may have. Nothing loads until a page is shown.
 */
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { useLinkViewStore, LINK_VIEW_SPLIT_WIDTH_VW } from '@/stores/link-view-store';
import { useLinkViewStatusStore } from '@/stores/link-view-status-store';
import { useTaskDetailVisibilityStore } from '@/stores/task-detail-visibility-store';
import { LINK_PANE_Z } from '@/lib/pane-layering';
import { isTauri, openExternalUrl } from '@/utils/tauri';
import { BrowserScreen } from './browser-screen/BrowserScreen';
import { LinkBandBar } from './browser-screen/LinkBandBar';
import { isBrowserRoute, useBrowserScreenSlotStore } from './browser-screen/browser-screen-slot';
import { useLinkViewReports } from './browser-screen/useLinkViewReports';
import { LinkFavourites } from './LinkFavourites';
import { LinkViewPane } from './LinkViewPane';
import { useLinkView } from './useLinkView';
import { useTaskPanelWidthVw } from './useTaskPanelWidth';

/**
 * The edge the link pane takes.
 *
 * It goes opposite the task detail panel whenever that panel is on screen,
 * because both defaulting to the right put one on top of the other (#1065).
 * With no task panel open the right edge is the default, matching where the
 * other docked panels sit.
 *
 * @param taskPanelVisible - Whether the task detail panel is open / タスク詳細の表示
 * @param taskPanelSide - Which edge that panel is on / タスク詳細のドック位置
 * @returns The edge the link pane should use / リンクペインのドック位置
 */
export function linkPaneSide(
  taskPanelVisible: boolean,
  taskPanelSide: 'left' | 'right',
): 'left' | 'right' {
  if (!taskPanelVisible) return 'right';
  return taskPanelSide === 'right' ? 'left' : 'right';
}

/**
 * How wide the pane is, in vw.
 *
 * It runs up to the task detail panel's actual edge rather than stopping at
 * a default width, because the panel's width is not a constant: tiled it is
 * 50vw, overlaid it is 75 / 66.7 / 50vw by breakpoint. Widening by the
 * tiled constant alone (#1068) left the default overlay case still showing
 * a strip of page between the two (#1072).
 *
 * @param taskPanelVw - The panel's measured width, 0 when absent / パネルの実測幅
 * @returns The pane width in vw / ペインの幅(vw)
 */
export function linkPaneWidthVw(taskPanelVw: number): number {
  if (taskPanelVw <= 0) return LINK_VIEW_SPLIT_WIDTH_VW;
  // Never collapse to nothing if the panel somehow reports the whole
  // viewport — a pane with no width would hide the page it is showing.
  return Math.max(100 - taskPanelVw, 20);
}

/** The docked link pane, the full /browser screen, or nothing. */
export default function LinkViewHost() {
  const pathname = usePathname();
  const onBrowserScreen = isBrowserRoute(pathname);
  const slot = useBrowserScreenSlotStore((s) => s.slot);
  // Read at once, not after mount: a first render as "web" on the desktop
  // would build iframes and fire an embed check. Hydration-safe because the
  // only thing it decides — the screen — renders after the slot mounts, never
  // during hydration; the pane does not depend on it.
  const [isDesktop] = useState(() => isTauri());

  const tabs = useLinkViewStore((s) => s.tabs);
  const activeId = useLinkViewStore((s) => s.activeId);
  const activateTab = useLinkViewStore((s) => s.activateTab);
  const openLink = useLinkViewStore((s) => s.openLink);
  const newTab = useLinkViewStore((s) => s.newTab);
  const closeTab = useLinkViewStore((s) => s.closeTab);
  const setTabUrl = useLinkViewStore((s) => s.setTabUrl);
  const applyPageChange = useLinkViewStore((s) => s.applyPageChange);
  const closeAll = useLinkViewStore((s) => s.closeAll);
  const isOpen = useLinkViewStore((s) => s.isOpen);
  const setOpen = useLinkViewStore((s) => s.setOpen);
  const view = useLinkViewStore((s) => s.view);
  const showLibrary = useLinkViewStore((s) => s.showLibrary);

  const taskPanelVisible = useTaskDetailVisibilityStore((s) => s.isTaskDetailVisible);
  const taskPanelSide = useTaskDetailVisibilityStore((s) => s.dockSide);
  const side = linkPaneSide(taskPanelVisible, taskPanelSide);
  const taskPanelVw = useTaskPanelWidthVw(taskPanelVisible);
  const widthVw = linkPaneWidthVw(taskPanelVw);

  // The element each layout lays the webview over; state (not a ref) so
  // switching layouts re-runs the webview effects against the new element.
  const [paneSurface, setPaneSurface] = useState<HTMLDivElement | null>(null);
  const [screenSurface, setScreenSurface] = useState<HTMLDivElement | null>(null);

  // A link the webview cannot take still has to go somewhere. The usual
  // cause is a desktop build made before tauri's `unstable` feature, where
  // the command does not exist. On /browser the screen says so first, so it
  // does not just go blank, and keeps the tabs; the pane keeps its old
  // behaviour of closing.
  const fallBackToBrowser = useCallback(
    (failed: string) => {
      if (isBrowserRoute(window.location.pathname)) {
        const id = useLinkViewStore.getState().activeId;
        if (id)
          useLinkViewStatusStore.getState().showBand(id, { kind: 'unavailable', url: failed });
      } else {
        closeAll();
      }
      void openExternalUrl(failed);
    },
    [closeAll],
  );

  const pageShown = onBrowserScreen
    ? Boolean(slot) && view !== 'library' && Boolean(activeId)
    : isOpen && view === 'page' && Boolean(activeId);
  // The screen only docks on the desktop; the web build draws iframes. The
  // pane keeps its old contract: no command outside Tauri means the
  // fallback sends the link to the browser.
  const docked = onBrowserScreen ? isDesktop && pageShown : pageShown;
  const webview = useLinkView(
    tabs,
    docked ? activeId : null,
    onBrowserScreen ? screenSurface : paneSurface,
    fallBackToBrowser,
    applyPageChange,
  );
  useLinkViewReports();

  // The webview is an OS surface that only follows the pane when told to.
  // A dock-side swap moves the pane without changing its size, and a
  // ResizeObserver never fires for that (#1068).
  useEffect(() => {
    webview.resync();
  }, [side, widthVw, webview]);

  // Esc closes the active tab in the pane, matching the split-view exit.
  // Not on /browser, where Esc in a page-sized screen closing a tab would
  // surprise far more than help.
  useEffect(() => {
    if (!activeId || !isOpen || onBrowserScreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTab(activeId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, isOpen, onBrowserScreen, closeTab]);

  if (onBrowserScreen) {
    // The pane is not drawn on /browser even when open — the screen shows
    // the same tabs — and AppContent reserves no width for it there.
    if (!slot) return null;
    return createPortal(
      <BrowserScreen
        isDesktop={isDesktop}
        surfaceRef={setScreenSurface}
        onHistory={webview.history}
      />,
      slot,
    );
  }

  if (!isOpen) return null;

  return (
    // top-16 so the header stays visible and interactive, matching
    // TaskSlidePanel. The stacking order lives in `pane-layering`.
    <div
      className={`fixed bottom-0 top-16 bg-white dark:bg-zinc-900 ${
        side === 'right' ? 'right-0' : 'left-0'
      }`}
      style={{ width: `${widthVw}vw`, zIndex: LINK_PANE_Z }}
    >
      {view === 'library' || !activeId ? (
        <LinkFavourites
          onOpen={(fav) => openLink(fav.url)}
          // ✕ closes the pane. Falling back to the page instead left no
          // way to dismiss it: closing that page's last tab came straight
          // back here.
          onClose={() => setOpen(false)}
        />
      ) : (
        <LinkViewPane
          tabs={tabs}
          activeId={activeId}
          surfaceRef={setPaneSurface}
          band={
            <LinkBandBar
              tabId={activeId}
              pageUrl={tabs.find((tab) => tab.id === activeId)?.url ?? ''}
              onReload={() => webview.history('reload')}
            />
          }
          onActivate={activateTab}
          onCloseTab={closeTab}
          onHistory={webview.history}
          onNavigate={(url) => setTabUrl(activeId, url)}
          onShowFavourites={showLibrary}
          onNewTab={newTab}
        />
      )}
    </div>
  );
}
