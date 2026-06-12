/**
 * TerminalProvider
 *
 * Mounts the integrated terminal dock once at the app root (so it persists
 * across route navigation), wires the Ctrl+J / Ctrl+` toggle shortcuts, and
 * focuses the leftmost pane whenever the dock opens. Opening is keyboard-only
 * (no on-screen button) by design.
 */
'use client';
import { useEffect } from 'react';
import { useTerminalStore } from './terminal-store';
import { focusTerminal } from './terminal-registry';
import TerminalPanel from './TerminalPanel';

export default function TerminalProvider() {
  const toggle = useTerminalStore((s) => s.toggle);
  const isOpen = useTerminalStore((s) => s.isOpen);
  const activeTabId = useTerminalStore((s) => s.activeTabId);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.altKey || !e.ctrlKey) return;
      // Ctrl+J is the primary toggle (reliable on JIS keyboards); Ctrl+`
      // mirrors VS Code where the layout allows it.
      const isToggleKey = e.key === 'j' || e.key === 'J' || e.key === '`' || e.code === 'Backquote';
      if (isToggleKey) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  // When the dock opens (or the active tab changes while open), move focus to
  // the active tab's leftmost pane. Retries briefly because the xterm instance
  // may still be initializing right after mount.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let attempts = 0;
    const tryFocus = () => {
      if (cancelled) return;
      const state = useTerminalStore.getState();
      const tab =
        state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[state.tabs.length - 1];
      const leftmost = tab?.panes[0];
      if (tab && leftmost) {
        if (tab.activePaneId !== leftmost.id) state.setActivePane(tab.id, leftmost.id);
        if (focusTerminal(leftmost.id)) return;
      }
      if (attempts++ < 20) setTimeout(tryFocus, 50);
    };
    const timer = setTimeout(tryFocus, 30);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, activeTabId]);

  return <TerminalPanel />;
}
