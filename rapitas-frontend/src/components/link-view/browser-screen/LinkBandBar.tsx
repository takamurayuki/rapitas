'use client';
/**
 * LinkBandBar
 *
 * The one-line band above a tab's page: a navigation or new window the
 * in-app browser refused, a blocked download, a slow load, an address that
 * cannot be opened here. It sits in its own row above the page, never on top
 * of it — the desktop page is an OS surface no HTML can cover.
 *
 * The URL is shown as plain text only (nav60 §5.1).
 */
import { useTranslations } from 'next-intl';
import { ExternalLink, RotateCw, TriangleAlert, X } from 'lucide-react';
import { useLinkViewStatusStore, type LinkBandKind } from '@/stores/link-view-status-store';
import { openExternalUrl } from '@/utils/tauri';
import { canShowInLinkView } from '@/utils/link-view';

const MESSAGE_KEY: Record<LinkBandKind, string> = {
  'navigation-blocked': 'bandNavigationBlocked',
  'new-window-blocked': 'bandNewWindowBlocked',
  'download-blocked': 'bandDownloadBlocked',
  'slow-load': 'bandSlowLoad',
  'entry-blocked': 'bandNavigationBlocked',
  unavailable: 'bandUnavailable',
};

interface LinkBandBarProps {
  tabId: string;
  /** The tab's current page, offered externally when the band's URL is not http(s). */
  pageUrl: string;
  onReload?: () => void;
}

/**
 * @param props - The tab, its page URL, and a reload action / 対象タブと操作
 */
export function LinkBandBar({ tabId, pageUrl, onReload }: LinkBandBarProps) {
  const t = useTranslations('browser');
  const tl = useTranslations('linkView');
  const band = useLinkViewStatusStore((s) => s.bands[tabId]);
  const dismiss = useLinkViewStatusStore((s) => s.dismissBand);
  if (!band) return null;

  // A blob:/data: download (or a refused non-web URL) cannot be handed to the
  // browser, so the page it came from is opened instead.
  const external = canShowInLinkView(band.url) ? band.url : pageUrl;
  // A refused http(s) address (e.g. a dev server on :3000) is offered to the
  // external browser, as §5.3 asks; a refused `javascript:` and the like has
  // nothing sensible to hand on.
  const offerExternal = band.kind !== 'entry-blocked' || canShowInLinkView(band.url);

  return (
    <div
      role="status"
      data-testid="link-band"
      data-band-kind={band.kind}
      className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate" title={band.url}>
        {t(MESSAGE_KEY[band.kind])}
      </span>
      {band.kind === 'slow-load' && onReload && (
        <button
          type="button"
          onClick={onReload}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-amber-100 dark:hover:bg-amber-500/20"
        >
          <RotateCw className="h-3 w-3" />
          {tl('reload')}
        </button>
      )}
      {offerExternal && (
        <button
          type="button"
          onClick={() => void openExternalUrl(external)}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-amber-100 dark:hover:bg-amber-500/20"
        >
          <ExternalLink className="h-3 w-3" />
          {tl('openExternally')}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss(tabId)}
        aria-label={tl('close')}
        title={tl('close')}
        className="shrink-0 rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-500/20"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
