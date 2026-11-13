'use client';
/**
 * BrowserExternalStart
 *
 * The /browser screen when it cannot show a page in-app: an address bar and
 * the saved pages, both opening in the external browser regardless of the
 * "how links open" setting. Not responsible for in-app display — that is the
 * full-screen link view LinkViewHost portals into the screen's slot.
 *
 * It goes through `openExternalUrlInSplitView` (the external branch of
 * `openExternalLink`) and never `openExternalLink` itself, which would open
 * the docked pane under the `internal` setting.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { LinkFavourites } from '@/components/link-view/LinkFavourites';
import { toNavigableUrl } from '@/components/link-view/LinkViewPane';
import { canShowInLinkView } from '@/utils/link-view';
import { openExternalUrlInSplitView } from '@/utils/tauri';
import { isImeComposing } from '@/utils/ime';

/**
 * Open a URL from the browser screen in the external browser (a new tab on
 * the web).
 *
 * @param url - A URL that already passed `toNavigableUrl` / 開く URL
 * @returns True when it was handed on / 外部に渡したら true
 */
export function openFromBrowserScreen(url: string): boolean {
  if (!canShowInLinkView(url)) return false;
  void openExternalUrlInSplitView(url);
  return true;
}

/** Address bar plus favourites, opening everything externally. */
export function BrowserExternalStart() {
  const t = useTranslations('browser');
  const tl = useTranslations('linkView');
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The screen exists to go somewhere, so the address bar is ready to type
  // into. Focused here rather than with autoFocus (jsx-a11y/no-autofocus).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const url = toNavigableUrl(draft);
    if (url && openFromBrowserScreen(url)) setDraft('');
  };

  return (
    <div
      className="flex h-[calc(100vh-4rem)] min-h-0 flex-col bg-white dark:bg-zinc-900"
      data-testid="browser-external-start"
    >
      <div className="shrink-0 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
        <div className="flex items-center gap-1">
          <input
            type="text"
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isImeComposing(e)) submit();
              if (e.key === 'Escape') setDraft('');
            }}
            spellCheck={false}
            aria-label={tl('addressLabel')}
            placeholder={t('addressPlaceholder')}
            className="min-w-0 flex-1 rounded border border-transparent bg-zinc-100 px-3 py-1.5 text-sm text-zinc-700 outline-none focus:border-indigo-400 focus:bg-white dark:bg-zinc-800 dark:text-zinc-200 dark:focus:bg-zinc-900"
          />
          <button
            type="button"
            onClick={submit}
            title={tl('openExternally')}
            aria-label={tl('openExternally')}
            className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{t('opensExternally')}</p>
      </div>
      <div className="min-h-0 flex-1">
        <LinkFavourites onOpen={(fav) => void openFromBrowserScreen(fav.url)} />
      </div>
    </div>
  );
}
