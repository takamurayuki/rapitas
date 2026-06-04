/**
 * TerminalPaneGroup
 *
 * Lays out a tab's panes side by side (row) or stacked (column) with thin
 * dividers. Every pane stays mounted so its scrollback and PTY survive.
 */
'use client';
import TerminalView from './TerminalView';
import type { TabState } from './terminal.types';
import { useTerminalStore } from './terminal-store';

/**
 * @param tab - The tab whose panes to render / 描画対象のタブ
 */
export default function TerminalPaneGroup({ tab }: { tab: TabState }) {
  const setActivePane = useTerminalStore((s) => s.setActivePane);
  const closePane = useTerminalStore((s) => s.closePane);

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 gap-px bg-zinc-700 ${
        tab.direction === 'row' ? 'flex-row' : 'flex-col'
      }`}
    >
      {tab.panes.map((pane) => (
        <div key={pane.id} className="group flex min-h-0 min-w-0 flex-1 bg-[#1e1e2e]">
          <TerminalView
            sessionId={pane.id}
            cwd={tab.cwd}
            isActive={tab.activePaneId === pane.id}
            closable={tab.panes.length > 1}
            onFocus={() => setActivePane(tab.id, pane.id)}
            onClose={() => closePane(tab.id, pane.id)}
          />
        </div>
      ))}
    </div>
  );
}
