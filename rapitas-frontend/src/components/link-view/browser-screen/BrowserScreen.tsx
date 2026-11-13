'use client';
/**
 * BrowserScreen
 *
 * The full-screen face of the in-app browser, portalled by LinkViewHost into
 * the /browser page's slot. Same tabs and favourites as the docked pane — it
 * is the same browser in another layout. Not responsible for the webviews:
 * on the desktop it only provides the surface element they are laid over.
 *
 * Layout: tab strip, toolbar (+ progress), band, then the page area — the
 * desktop surface, the web iframes, or the favourites when there is no page.
 * The web build also states the shared-history caveat (Q10) with a way back
 * to the previous app screen.
 */
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useLinkViewStore } from '@/stores/link-view-store';
import { useLinkLibraryStore } from '@/stores/link-library-store';
import { useLinkViewStatusStore } from '@/stores/link-view-status-store';
import { useNavigationHistoryStore } from '@/components/header/history/navigation-history-store';
import { browserUrlRefusal, resolveAddressInput } from '@/utils/browser-url-policy';
import { openExternalUrl } from '@/utils/tauri';
import { LinkFavourites } from '../LinkFavourites';
import { TabStrip } from '../tab-strip';
import { saveTabToFavourites } from './save-favourite';
import { BrowserToolbar } from './BrowserToolbar';
import { BrowserWebFrames } from './BrowserWebFrames';
import { LinkBandBar } from './LinkBandBar';
import { useClearBrowsingData } from './useClearBrowsingData';

interface BrowserScreenProps {
  isDesktop: boolean;
  /** Ref callback for the element the desktop webview is laid over. */
  surfaceRef: (el: HTMLDivElement | null) => void;
  /** Page history / reload on the desktop webview. */
  onHistory: (action: 'back' | 'forward' | 'reload') => void;
}

/** Where "previous screen" goes: the app route before /browser, else home. */
function previousAppRoute(entries: string[], index: number): string {
  return (index > 0 && entries[index - 1]) || '/';
}

/**
 * @param props - Platform, the surface ref and the history control / 表示先と操作
 */
export function BrowserScreen({ isDesktop, surfaceRef, onHistory }: BrowserScreenProps) {
  const t = useTranslations('browser');
  const router = useRouter();
  const tabs = useLinkViewStore((s) => s.tabs);
  const activeId = useLinkViewStore((s) => s.activeId);
  const view = useLinkViewStore((s) => s.view);
  const { activateTab, closeTab, newTab, openLink, setTabUrl, showLibrary, showPage } =
    useLinkViewStore.getState();
  const showBand = useLinkViewStatusStore((s) => s.showBand);
  const desktopLoading = useLinkViewStatusStore((s) =>
    activeId ? s.loadingSince[activeId] !== undefined : false,
  );
  const clearBrowsingData = useClearBrowsingData();
  const [webLoading, setWebLoading] = useState(false);
  const [reloads, setReloads] = useState<Record<string, number>>({});
  /** A refused address typed on the start page, where there is no tab band. */
  const [startRefusal, setStartRefusal] = useState(false);

  const active = tabs.find((tab) => tab.id === activeId) ?? null;
  const page = view === 'library' ? null : active;
  const saved = useLinkLibraryStore((s) => s.favourites.some((f) => f.url === page?.url));

  const submit = (typed: string) => {
    const url = resolveAddressInput(typed);
    if (!url) return;
    if (browserUrlRefusal(url)) {
      // Nothing is created for a refused address; the band says why and,
      // for an http(s) one (a dev server on :3000), offers the browser.
      if (active) showBand(active.id, { kind: 'entry-blocked', url });
      else setStartRefusal(true);
      return;
    }
    setStartRefusal(false);
    if (page) setTabUrl(page.id, url);
    else openLink(url);
  };

  const reload = useCallback(() => {
    if (!page) return;
    if (isDesktop) onHistory('reload');
    else setReloads((r) => ({ ...r, [page.id]: (r[page.id] ?? 0) + 1 }));
  }, [page, isDesktop, onHistory]);

  // NOTE: The tab strip stays visible over the favourites here (the pane
  // swaps it out instead), so picking a tab must also leave the library view;
  // activateTab alone only moved the id and the page stayed hidden.
  const pickTab = (id: string) => {
    activateTab(id);
    showPage();
  };

  const goToPreviousScreen = () => {
    const { entries, index } = useNavigationHistoryStore.getState();
    router.push(previousAppRoute(entries, index));
  };

  return (
    <div
      data-testid="browser-screen"
      className="flex h-[calc(100vh-4rem)] min-h-0 flex-col bg-white dark:bg-zinc-900"
    >
      {tabs.length > 0 && (
        <TabStrip
          tabs={tabs}
          activeId={page?.id ?? ''}
          onActivate={pickTab}
          onCloseTab={closeTab}
          onNewTab={newTab}
        />
      )}
      <BrowserToolbar
        isDesktop={isDesktop}
        url={page?.url ?? ''}
        hasPage={Boolean(page)}
        saved={saved}
        loading={isDesktop ? desktopLoading : webLoading}
        autoFocusAddress={!page}
        onHistory={(action) => onHistory(action)}
        onReload={reload}
        onSubmit={submit}
        onSave={() => page && void saveTabToFavourites(page)}
        onShowFavourites={showLibrary}
        onOpenExternal={() => page && void openExternalUrl(page.url)}
        onClearData={() => void clearBrowsingData()}
      />
      {!isDesktop && page && (
        <div
          data-testid="browser-history-notice"
          className="flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
        >
          {/* Wraps rather than truncates: on a phone the caveat would
              otherwise lose its second half (nav60 §9: nothing cut at 390px). */}
          <span className="min-w-0 flex-1 leading-snug">{t('historyNotice')}</span>
          <button
            type="button"
            onClick={goToPreviousScreen}
            className="shrink-0 rounded px-1 font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10"
          >
            {t('previousScreen')}
          </button>
        </div>
      )}
      {active && <LinkBandBar tabId={active.id} pageUrl={active.url} onReload={reload} />}

      {!page ? (
        <div className="min-h-0 flex-1" data-testid="browser-start">
          <p
            role={startRefusal ? 'status' : undefined}
            className={`border-b border-zinc-100 px-3 py-2 text-xs dark:border-zinc-800 ${
              startRefusal
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            {startRefusal ? t('bandNavigationBlocked') : t('emptyHint')}
          </p>
          <LinkFavourites onOpen={(fav) => openLink(fav.url)} />
        </div>
      ) : isDesktop ? (
        // The webview covers this box; it stays empty because anything drawn
        // here would be under the OS surface. Its background shows while the
        // webview is hidden (an overlay is open) or still docking.
        <div
          ref={surfaceRef}
          data-testid="browser-surface"
          className="min-h-0 flex-1 bg-zinc-50 dark:bg-zinc-900"
        />
      ) : (
        <BrowserWebFrames
          tabs={tabs}
          activeId={page.id}
          reloads={reloads}
          onSaveFavourite={() => page && void saveTabToFavourites(page)}
          onLoadingChange={setWebLoading}
        />
      )}
    </div>
  );
}
