/**
 * TerminalPanel
 *
 * Holds the tab bar and the active tab's panes, in one of two layouts:
 *  - 'overlay' (default): a bottom dock that slides up/down over the page.
 *  - 'split': docked to the left or right edge, full height, sliding in/out
 *    horizontally. AppContent reserves matching space so the page content
 *    is genuinely side-by-side rather than covered.
 * Either way the panel stays mounted while tabs exist (only its transform
 * changes) so each terminal's scrollback and live PTY survive toggling.
 * Clicking outside closes it in overlay mode only — split mode behaves like
 * a persistent side panel, not a transient one.
 */
'use client';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useTerminalStore } from './terminal-store';
import { isTauri } from './terminal-ipc';
import { useNavStore } from '@/stores/nav-store';
import TerminalTabBar from './TerminalTabBar';
import TerminalPaneGroup from './TerminalPaneGroup';

export default function TerminalPanel() {
  const t = useTranslations('terminal');
  const isOpen = useTerminalStore((s) => s.isOpen);
  const close = useTerminalStore((s) => s.close);
  const height = useTerminalStore((s) => s.height);
  const setHeight = useTerminalStore((s) => s.setHeight);
  const displayMode = useTerminalStore((s) => s.displayMode);
  const dockSide = useTerminalStore((s) => s.dockSide);
  const splitWidthPercent = useTerminalStore((s) => s.splitWidthPercent);
  const setSplitWidthPercent = useTerminalStore((s) => s.setSplitWidthPercent);
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const isMenuPinned = useNavStore((s) => s.isMenuPinned);
  const dragging = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const isSplit = displayMode === 'split';

  const onDragStartHeight = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        // Dock is anchored to the bottom; height grows as the cursor moves up.
        setHeight(window.innerHeight - ev.clientY);
      };
      const onUp = () => {
        dragging.current = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [setHeight],
  );

  const onDragStartWidth = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const vw = window.innerWidth;
        // Right-docked: width grows as the cursor moves left (away from the
        // right edge). Left-docked: width grows as the cursor moves right.
        const percent =
          dockSide === 'right' ? ((vw - ev.clientX) / vw) * 100 : (ev.clientX / vw) * 100;
        setSplitWidthPercent(percent);
      };
      const onUp = () => {
        dragging.current = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [dockSide, setSplitWidthPercent],
  );

  // Click outside the dock slides it away — overlay mode only. Split mode is
  // a persistent side panel (like a pinned nav), so it stays open regardless
  // of where the user clicks; Ctrl+J or the close button are how you close it.
  useEffect(() => {
    if (!isOpen || isSplit) return;
    const onMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const timer = window.setTimeout(() => document.addEventListener('mousedown', onMouseDown), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [isOpen, isSplit, close]);

  // Keep the panel mounted while tabs exist (slides off-screen when closed) so
  // scrollback and live PTYs survive a toggle. Fully unmount only with no tabs.
  if (tabs.length === 0) return null;

  const closedTransform = isSplit
    ? dockSide === 'right'
      ? 'translate-x-full'
      : '-translate-x-full'
    : 'translate-y-full';

  return (
    <div
      ref={panelRef}
      className={`fixed z-60 flex flex-col border-zinc-700 bg-zinc-900 shadow-2xl transition-transform duration-200 ease-out ${
        isSplit
          ? // top-16 matches the sticky header's h-16 (see TaskSlidePanel) — the
            // header is z-110, above this panel's z-60, so starting at inset-y-0
            // (the viewport top) would render the header over the tab bar and
            // top of the terminal, hiding both. Same reasoning for lg:left-72
            // when docked left with the nav pinned (nav is z-100, w-72).
            `top-16 bottom-0 ${
              dockSide === 'right'
                ? 'right-0 border-l'
                : `left-0 border-r ${isMenuPinned ? 'lg:left-72' : ''}`
            }`
          : 'inset-x-0 bottom-0 border-t'
      } ${isOpen ? 'translate-x-0 translate-y-0' : `${closedTransform} pointer-events-none`}`}
      style={isSplit ? { width: `${splitWidthPercent}vw` } : { height }}
    >
      {isSplit ? (
        // Inner edge: drag to resize the dock's width.
        <div
          onMouseDown={onDragStartWidth}
          className={`absolute inset-y-0 w-1 cursor-col-resize bg-transparent hover:bg-indigo-500/50 ${
            dockSide === 'right' ? 'left-0' : 'right-0'
          }`}
          role="separator"
          aria-orientation="vertical"
        />
      ) : (
        // Top edge: drag to resize the dock's height.
        <div
          onMouseDown={onDragStartHeight}
          className="h-1 w-full cursor-row-resize bg-transparent hover:bg-indigo-500/50"
          role="separator"
          aria-orientation="horizontal"
        />
      )}
      <TerminalTabBar />

      <div className="flex min-h-0 flex-1">
        {!isTauri() ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-zinc-500">
            {t('desktopOnly')}
          </div>
        ) : (
          tabs.map((tab) => (
            <div key={tab.id} className={tab.id === activeTabId ? 'flex min-h-0 flex-1' : 'hidden'}>
              <TerminalPaneGroup tab={tab} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
