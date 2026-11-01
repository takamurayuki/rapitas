'use client';
/**
 * LinkViewHost
 *
 * Mounts the in-app link pane once, in the app shell, so a link clicked
 * anywhere can dock into it. Renders nothing until a link is opened, which
 * is also when the first Tauri child webview is created.
 *
 * Placement is decided here rather than in the pane: the pane draws, the
 * host decides which edge it may have.
 */
import { useCallback, useEffect } from 'react';
import { useLinkViewStore, LINK_VIEW_SPLIT_WIDTH_VW } from '@/stores/link-view-store';
import { useTaskDetailVisibilityStore } from '@/stores/task-detail-visibility-store';
import { LINK_PANE_Z } from '@/lib/pane-layering';
import { openExternalUrl } from '@/utils/tauri';
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

/** The docked link pane, or nothing when no link is open. */
export default function LinkViewHost() {
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
  const paneView = useLinkViewStore((s) => s.view);
  const showLibrary = useLinkViewStore((s) => s.showLibrary);

  const taskPanelVisible = useTaskDetailVisibilityStore((s) => s.isTaskDetailVisible);
  const taskPanelSide = useTaskDetailVisibilityStore((s) => s.dockSide);
  const side = linkPaneSide(taskPanelVisible, taskPanelSide);
  const taskPanelVw = useTaskPanelWidthVw(taskPanelVisible);
  const widthVw = linkPaneWidthVw(taskPanelVw);

  // A link the pane cannot take still has to go somewhere. The usual cause
  // is a desktop build made before tauri's `unstable` feature was enabled,
  // where the command simply does not exist — the setting is switchable
  // then, so a silent no-op would look like a broken link.
  const fallBackToBrowser = useCallback(
    (failed: string) => {
      closeAll();
      void openExternalUrl(failed);
    },
    [closeAll],
  );

  const paneShowsAPage = isOpen && paneView === 'page' && Boolean(activeId);
  const webview = useLinkView(
    tabs,
    paneShowsAPage ? activeId : null,
    fallBackToBrowser,
    applyPageChange,
  );

  // The webview is an OS surface that only follows the pane when told to.
  // A dock-side swap moves the pane without changing its size, and a
  // ResizeObserver never fires for that — the surface stayed where it was,
  // leaving the page content stranded on the old side (#1068).
  useEffect(() => {
    webview.resync();
  }, [side, widthVw, webview]);

  // Esc closes the active tab, matching the split-view exit the app has.
  useEffect(() => {
    if (!activeId || !isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTab(activeId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, isOpen, closeTab]);

  if (!isOpen) return null;

  return (
    // top-16 so the header stays visible and interactive, matching
    // TaskSlidePanel. The stacking order lives in `pane-layering` — this
    // pane has to clear the task panel's overlay or that overlay takes
    // every click meant for it.
    <div
      className={`fixed bottom-0 top-16 bg-white dark:bg-zinc-900 ${
        side === 'right' ? 'right-0' : 'left-0'
      }`}
      style={{ width: `${widthVw}vw`, zIndex: LINK_PANE_Z }}
    >
      {paneView === 'library' || !activeId ? (
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
          placeholderRef={webview.placeholderRef}
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
