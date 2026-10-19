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
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  ExternalLink,
  X,
  Bookmark,
  BookmarkPlus,
  Plus,
  Globe,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { useLinkLibraryStore } from '@/stores/link-library-store';
import { openExternalUrl } from '@/utils/tauri';
import { faviconFor, hostOf, tabLabel } from './link-tab-meta';
import type { LinkTab } from '@/stores/link-view-store';

interface LinkViewPaneProps {
  tabs: LinkTab[];
  activeId: string;
  /** The element the active webview is sized to. / webview の矩形基準 */
  placeholderRef: React.RefObject<HTMLDivElement | null>;
  onActivate: (id: string) => void;
  onCloseTab: (id: string) => void;
  onHistory: (action: 'back' | 'forward' | 'reload') => void;
  /** Point the active tab at a different URL. / 遷移先の変更 */
  onNavigate: (url: string) => void;
  /** Open the saved-pages view. / お気に入りを開く */
  onShowFavourites: () => void;
  /** Open a new tab at the default page. / 新しいタブ */
  onNewTab: () => void;
}

/**
 * What someone typed, as a URL the pane can show.
 *
 * A bare host is the usual thing to type, and the webview only accepts
 * http(s) — so the scheme is added rather than the entry rejected.
 *
 * @param typed - The address bar's contents / 入力された文字列
 * @returns A loadable URL, or null when it is not one / 遷移先、不正なら null
 */
export function toNavigableUrl(typed: string): string | null {
  const trimmed = typed.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
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
  onNavigate,
  onShowFavourites,
  onNewTab,
}: LinkViewPaneProps) {
  const t = useTranslations('linkView');
  const active = tabs.find((tab) => tab.id === activeId);

  // Local while typing so the field does not fight the user, and resynced
  // whenever the tab or its URL changes underneath (a tab switch, a link
  // followed inside the page).
  const [draft, setDraft] = useState(active?.url ?? '');
  useEffect(() => {
    setDraft(active?.url ?? '');
  }, [active?.id, active?.url]);

  const groups = useLinkLibraryStore((s) => s.groups);
  const addFavourite = useLinkLibraryStore((s) => s.addFavourite);
  const saved = useLinkLibraryStore((s) => s.favourites.some((f) => f.url === active?.url));

  /**
   * Save the page, resolving its title and icon first.
   *
   * The same endpoint the note editor's link cards use. It falls back to
   * the host rather than failing: a saved page with a plain title beats a
   * save that silently did nothing.
   */
  const save = async () => {
    if (!active) return;
    let title = hostOf(active.url);
    let favicon = '';
    try {
      const res = await fetch(`${API_BASE_URL}/url-metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: active.url }),
      });
      const meta = await res.json();
      title = meta.title || title;
      favicon = meta.favicon || '';
    } catch {
      // Keep the host-derived title.
    }
    addFavourite({ url: active.url, title, favicon, groupId: active.groupId ?? null });
  };

  const submit = () => {
    const url = toNavigableUrl(draft);
    if (url) onNavigate(url);
    else setDraft(active?.url ?? '');
  };

  return (
    <div className="flex h-full min-w-0 flex-col border-l border-zinc-200 dark:border-zinc-700">
      {/* Tab strip */}
      <div className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-zinc-200 px-1 pt-1 dark:border-zinc-700">
        {tabs.map((tab) => {
          const on = tab.id === activeId;
          const group = groups.find((g) => g.id === tab.groupId);
          // The page's own title, so a row of tabs all sitting on the same
          // host can still be told apart.
          const label = tabLabel(tab);
          const icon = faviconFor(tab.url);
          return (
            <div
              key={tab.id}
              className={`group flex min-w-0 max-w-44 items-center gap-1 rounded-t border-b-2 px-2 py-1 text-xs transition-colors ${
                on
                  ? 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/60'
              }`}
              // A grouped tab is marked in its group's colour, which is the
              // same colour the group's heading carries in the library.
              style={{
                borderBottomColor: group?.color ?? (on ? '#6366f1' : 'transparent'),
              }}
            >
              <button
                type="button"
                onClick={() => onActivate(tab.id)}
                title={`${label}\n${tab.url}`}
                className="flex min-w-0 flex-1 items-center gap-1 text-left"
              >
                {icon ? (
                  // A 16px favicon from an external host: next/image would
                  // need remote patterns and would proxy it, for no gain.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={icon} alt="" width={14} height={14} className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Globe className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                )}
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>
              <button
                type="button"
                onClick={() => onCloseTab(tab.id)}
                aria-label={t('closeTab', { host: label })}
                className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={onNewTab}
          title={t('newTab')}
          aria-label={t('newTab')}
          className="my-0.5 shrink-0 rounded px-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
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

        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            // Esc closes the pane at the window level; inside the field it
            // should only abandon the edit.
            if (e.key === 'Escape') {
              e.stopPropagation();
              setDraft(active?.url ?? '');
            }
          }}
          onBlur={submit}
          spellCheck={false}
          aria-label={t('addressLabel')}
          title={active?.url}
          className="mx-1 min-w-0 flex-1 truncate rounded border border-transparent bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 outline-none focus:border-indigo-400 focus:bg-white dark:bg-zinc-800 dark:text-zinc-200 dark:focus:bg-zinc-900"
        />

        <button
          onClick={() => void save()}
          title={saved ? t('alreadySaved') : t('saveToFavourites')}
          className={iconButton}
        >
          {saved ? (
            <Bookmark className="h-3.5 w-3.5 fill-current text-indigo-500" />
          ) : (
            <BookmarkPlus className="h-3.5 w-3.5" />
          )}
        </button>
        <button onClick={onShowFavourites} title={t('favourites')} className={iconButton}>
          <Bookmark className="h-3.5 w-3.5" />
        </button>
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
