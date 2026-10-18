'use client';
/**
 * LinkViewPane
 *
 * The in-app reading pane: a tab strip and the chrome around whichever page
 * is showing. The page itself is a Tauri child webview laid over the
 * placeholder below — this component owns only what is drawn in HTML.
 *
 * NOTE: the placeholder stays empty on purpose. Anything rendered inside it
 * would be hidden by the webview's own surface, which an OS-level view
 * always paints above regardless of z-index.
 */
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, X } from 'lucide-react';
import { openExternalUrl } from '@/utils/tauri';
import type { LinkTab } from '@/stores/link-view-store';

interface LinkViewPaneProps {
  tabs: LinkTab[];
  activeId: string;
  /** The element the active webview is sized to. / webview の矩形基準 */
  placeholderRef: React.RefObject<HTMLDivElement | null>;
  onActivate: (id: string) => void;
  onCloseTab: (id: string) => void;
  onHistory: (action: 'back' | 'forward' | 'reload') => void;
}

/** The host of a URL, or the whole string when it will not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const iconButton =
  'rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100';

/**
 * @param props - The open tabs, the active one, and the pane's controls
 */
export function LinkViewPane({
  tabs,
  activeId,
  placeholderRef,
  onActivate,
  onCloseTab,
  onHistory,
}: LinkViewPaneProps) {
  const t = useTranslations('linkView');
  const active = tabs.find((tab) => tab.id === activeId);

  return (
    <div className="flex h-full min-w-0 flex-col border-l border-zinc-200 dark:border-zinc-700">
      {/* Tab strip */}
      <div className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-zinc-200 px-1 pt-1 dark:border-zinc-700">
        {tabs.map((tab) => {
          const on = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={`group flex min-w-0 max-w-44 items-center gap-1 rounded-t border-b-2 px-2 py-1 text-xs transition-colors ${
                on
                  ? 'border-indigo-500 bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
                  : 'border-transparent text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/60'
              }`}
            >
              <button
                type="button"
                onClick={() => onActivate(tab.id)}
                title={tab.url}
                className="min-w-0 flex-1 truncate text-left"
              >
                {hostOf(tab.url)}
              </button>
              <button
                type="button"
                onClick={() => onCloseTab(tab.id)}
                aria-label={t('closeTab', { host: hostOf(tab.url) })}
                className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Address bar for the active tab */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-zinc-200 px-2 py-1 dark:border-zinc-700">
        <button onClick={() => onHistory('back')} title={t('back')} className={iconButton}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => onHistory('forward')} title={t('forward')} className={iconButton}>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => onHistory('reload')} title={t('reload')} className={iconButton}>
          <RotateCw className="h-3.5 w-3.5" />
        </button>

        <span
          className="mx-1 min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400"
          title={active?.url}
        >
          {active ? hostOf(active.url) : ''}
        </span>

        <button
          onClick={() => active && void openExternalUrl(active.url)}
          title={t('openExternally')}
          className={iconButton}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => onCloseTab(activeId)} title={t('close')} className={iconButton}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* The webview covers this box; leaving it empty avoids drawing content
          nobody can see. The background shows for the frame before it docks. */}
      <div ref={placeholderRef} className="min-h-0 flex-1 bg-zinc-50 dark:bg-zinc-900" />
    </div>
  );
}
