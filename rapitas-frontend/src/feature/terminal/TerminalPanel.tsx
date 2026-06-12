/**
 * TerminalPanel
 *
 * Bottom dock holding the tab bar and the active tab's panes. Slides up/down
 * (transform) so toggling preserves each terminal's scrollback and live PTY.
 * Clicking outside the dock, or toggling with Ctrl+J, slides it back down.
 */
'use client';
import { useCallback, useEffect, useRef } from 'react';
import { useTerminalStore } from './terminal-store';
import { isTauri } from './terminal-ipc';
import TerminalTabBar from './TerminalTabBar';
import TerminalPaneGroup from './TerminalPaneGroup';

export default function TerminalPanel() {
  const isOpen = useTerminalStore((s) => s.isOpen);
  const close = useTerminalStore((s) => s.close);
  const height = useTerminalStore((s) => s.height);
  const setHeight = useTerminalStore((s) => s.setHeight);
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const dragging = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const onDragStart = useCallback(
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

  // Click outside the dock slides it away. Attach on the next tick so the
  // click that opened the panel doesn't immediately close it.
  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen, close]);

  // Keep the panel mounted while tabs exist (slides off-screen when closed) so
  // scrollback and live PTYs survive a toggle. Fully unmount only with no tabs.
  if (tabs.length === 0) return null;

  return (
    <div
      ref={panelRef}
      className={`fixed inset-x-0 bottom-0 z-40 flex flex-col border-t border-zinc-700 bg-zinc-900 shadow-2xl transition-transform duration-200 ease-out ${
        isOpen ? 'translate-y-0' : 'translate-y-full pointer-events-none'
      }`}
      style={{ height }}
    >
      {/* Top edge: drag to resize the dock. */}
      <div
        onMouseDown={onDragStart}
        className="h-1 w-full cursor-row-resize bg-transparent hover:bg-indigo-500/50"
        role="separator"
        aria-orientation="horizontal"
      />
      <TerminalTabBar />

      <div className="flex min-h-0 flex-1">
        {!isTauri() ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-zinc-400">
            ターミナルはデスクトップアプリ (Tauri) でのみ利用できます。
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
