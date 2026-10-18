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
import { openExternalUrl } from '@/utils/tauri';
import { LinkViewPane } from './LinkViewPane';
import { useLinkView } from './useLinkView';

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

/** The docked link pane, or nothing when no link is open. */
export default function LinkViewHost() {
  const tabs = useLinkViewStore((s) => s.tabs);
  const activeId = useLinkViewStore((s) => s.activeId);
  const activateTab = useLinkViewStore((s) => s.activateTab);
  const closeTab = useLinkViewStore((s) => s.closeTab);
  const closeAll = useLinkViewStore((s) => s.closeAll);

  const taskPanelVisible = useTaskDetailVisibilityStore((s) => s.isTaskDetailVisible);
  const taskPanelSide = useTaskDetailVisibilityStore((s) => s.dockSide);
  const side = linkPaneSide(taskPanelVisible, taskPanelSide);

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

  const view = useLinkView(tabs, activeId, fallBackToBrowser);

  // Esc closes the active tab, matching the split-view exit the app has.
  useEffect(() => {
    if (!activeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTab(activeId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, closeTab]);

  if (!activeId || tabs.length === 0) return null;

  return (
    // top-16 so the header stays visible and interactive, matching
    // TaskSlidePanel. z-[60] keeps it under that panel (z-[70]) — docking
    // opposite means they should not meet, and if they ever do the task
    // panel is the one that must stay reachable.
    <div
      className={`fixed bottom-0 top-16 z-[60] bg-white dark:bg-zinc-900 ${
        side === 'right' ? 'right-0' : 'left-0'
      }`}
      style={{ width: `${LINK_VIEW_SPLIT_WIDTH_VW}vw` }}
    >
      <LinkViewPane
        tabs={tabs}
        activeId={activeId}
        placeholderRef={view.placeholderRef}
        onActivate={activateTab}
        onCloseTab={closeTab}
        onHistory={view.history}
      />
    </div>
  );
}
