/**
 * TerminalTabBar
 *
 * Tab strip plus panel controls (new tab, split active pane horizontally /
 * vertically, close panel). Pure UI over the terminal store.
 */
'use client';
import {
  Plus,
  X,
  SplitSquareHorizontal,
  SplitSquareVertical,
  SquareTerminal,
  Columns2,
  PanelBottom,
  ArrowLeftRight,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTerminalStore } from './terminal-store';

export default function TerminalTabBar() {
  const t = useTranslations('terminal');
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);
  const closeTab = useTerminalStore((s) => s.closeTab);
  const addTab = useTerminalStore((s) => s.addTab);
  const splitActivePane = useTerminalStore((s) => s.splitActivePane);
  const close = useTerminalStore((s) => s.close);
  const displayMode = useTerminalStore((s) => s.displayMode);
  const setDisplayMode = useTerminalStore((s) => s.setDisplayMode);
  const dockSide = useTerminalStore((s) => s.dockSide);
  const toggleDockSide = useTerminalStore((s) => s.toggleDockSide);
  const isSplit = displayMode === 'split';

  return (
    <div className="flex h-9 items-center justify-between border-b border-zinc-700 bg-zinc-900 px-2">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`group flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs ${
              tab.id === activeTabId
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            <button
              type="button"
              className="flex items-center gap-1"
              onClick={() => setActiveTab(tab.id)}
            >
              <SquareTerminal className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="max-w-[120px] truncate">{tab.title}</span>
            </button>
            <button
              type="button"
              onClick={() => closeTab(tab.id)}
              className="rounded p-0.5 text-zinc-500 hover:bg-zinc-600 hover:text-zinc-100"
              aria-label={t('closeTabAria', { title: tab.title })}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-1 text-zinc-400">
        <button
          type="button"
          onClick={() => splitActivePane('row')}
          className="rounded p-1 hover:bg-zinc-700 hover:text-zinc-100"
          aria-label={t('splitHorizontal')}
          title={t('splitHorizontal')}
        >
          <SplitSquareHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => splitActivePane('column')}
          className="rounded p-1 hover:bg-zinc-700 hover:text-zinc-100"
          aria-label={t('splitVertical')}
          title={t('splitVertical')}
        >
          <SplitSquareVertical className="h-4 w-4" aria-hidden="true" />
        </button>
        {isSplit && (
          <button
            type="button"
            onClick={() => toggleDockSide()}
            className="rounded p-1 hover:bg-zinc-700 hover:text-zinc-100"
            aria-label={t('swapDockSideAria')}
            title={dockSide === 'right' ? t('dockLeft') : t('dockRight')}
          >
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setDisplayMode(isSplit ? 'overlay' : 'split')}
          className="rounded p-1 hover:bg-zinc-700 hover:text-zinc-100"
          aria-label={isSplit ? t('switchToOverlayMode') : t('switchToSplitMode')}
          title={isSplit ? t('switchToOverlayMode') : t('switchToSplitMode')}
        >
          {isSplit ? (
            <PanelBottom className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Columns2 className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={() => addTab()}
          className="rounded p-1 hover:bg-zinc-700 hover:text-zinc-100"
          aria-label={t('newTerminal')}
          title={t('newTerminal')}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => close()}
          className="rounded p-1 hover:bg-zinc-700 hover:text-zinc-100"
          aria-label={t('closeTerminal')}
          title={t('closeTerminalTitle')}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
