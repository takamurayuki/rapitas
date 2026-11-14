'use client';
/**
 * BrowserWebFrames
 *
 * The web app's page area on /browser: one sandboxed iframe per tab, kept
 * (hidden) while the user stays on /browser so switching tabs keeps each
 * page's scroll and input. A page the backend judged `refused` gets a card
 * instead of a frame that would only show blank.
 *
 * `load` only ends the progress bar — it fires for refused and error pages
 * too, so it is never taken as proof the page displayed. The rescue line with
 * "open externally" therefore stays whatever the verdict (nav60 §1.2, §3.2).
 *
 * NOTE: a frame's key includes the URL and a reload counter. Changing the
 * URL or reloading rebuilds the frame instead of setting `src`, because a
 * new element's first load adds no entry to the shared session history.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BookmarkPlus, ExternalLink, MonitorX } from 'lucide-react';
import type { LinkTab } from '@/stores/link-view-store';
import { openExternalUrl } from '@/utils/tauri';
import { hostOf } from '../link-tab-meta';
import { useEmbedVerdicts, type EmbedVerdict } from './useEmbedCheck';

/**
 * Permissions Policy for the frame: every powerful feature explicitly 'none'.
 * An empty `allow` would leave features whose default allowlist is `*`
 * enabled. fullscreen and clipboard-write stay at their defaults (video
 * fullscreen, copy buttons) — harmless to the app.
 */
export const FRAME_ALLOW =
  "camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; " +
  "clipboard-read 'none'; payment 'none'; usb 'none'; serial 'none'; hid 'none'; " +
  "bluetooth 'none'; midi 'none'; publickey-credentials-get 'none'; " +
  "publickey-credentials-create 'none'";

/**
 * No top navigation (the page cannot move the app), no downloads, and
 * popups stay inside the sandbox (Q12: no allow-popups-to-escape-sandbox).
 */
export const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups';

interface BrowserWebFramesProps {
  tabs: LinkTab[];
  activeId: string;
  /** Per-tab reload counter; bumping it rebuilds that tab's frame. */
  reloads: Record<string, number>;
  onSaveFavourite: () => void;
  /** Reports whether the active tab's frame is still loading. */
  onLoadingChange: (loading: boolean) => void;
}

/** The frame key: a new URL or a reload is a new element. */
function frameKey(tab: LinkTab, reloads: Record<string, number>): string {
  return `${tab.id}|${tab.url}|${reloads[tab.id] ?? 0}`;
}

/**
 * @param props - Tabs, the active one, reload counters and actions / タブと操作
 */
export function BrowserWebFrames({
  tabs,
  activeId,
  reloads,
  onSaveFavourite,
  onLoadingChange,
}: BrowserWebFramesProps) {
  const t = useTranslations('browser');
  const tl = useTranslations('linkView');
  const verdicts = useEmbedVerdicts(tabs.map((tab) => tab.url));
  const [loaded, setLoaded] = useState<Set<string>>(new Set());

  const active = tabs.find((tab) => tab.id === activeId);
  const activeVerdict: EmbedVerdict | undefined = active ? verdicts[active.url] : undefined;
  const activeKey = active ? frameKey(active, reloads) : '';
  const activeLoading =
    !!active &&
    activeVerdict !== undefined &&
    activeVerdict !== 'refused' &&
    !loaded.has(activeKey);

  useEffect(() => {
    onLoadingChange(activeLoading);
  }, [activeLoading, onLoadingChange]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 bg-white dark:bg-zinc-900">
        {tabs.map((tab) => {
          const verdict = verdicts[tab.url];
          if (verdict === undefined || verdict === 'refused') return null;
          const key = frameKey(tab, reloads);
          return (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- onLoad is the frame's load event, not a user interaction
            <iframe
              key={key}
              src={tab.url}
              title={tab.title || hostOf(tab.url)}
              sandbox={FRAME_SANDBOX}
              referrerPolicy="no-referrer"
              allow={FRAME_ALLOW}
              hidden={tab.id !== activeId}
              onLoad={() => setLoaded((s) => (s.has(key) ? s : new Set(s).add(key)))}
              data-testid="browser-web-frame"
              className="absolute inset-0 h-full w-full border-0"
            />
          );
        })}
        {active && activeVerdict === undefined && (
          <p className="absolute inset-x-0 top-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
            {t('checking')}
          </p>
        )}
        {active && activeVerdict === 'refused' && (
          <div
            data-testid="browser-refused-card"
            className="absolute inset-0 flex items-center justify-center p-6"
          >
            <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 text-center shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
              <MonitorX className="mx-auto h-6 w-6 text-zinc-400" />
              <p className="mt-3 text-balance [word-break:auto-phrase] text-sm font-medium text-zinc-800 dark:text-zinc-100">
                {t('refusedTitle')}
              </p>
              <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                {hostOf(active.url)}
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => void openExternalUrl(active.url)}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  <ExternalLink className="h-4 w-4" />
                  {tl('openExternally')}
                </button>
                <button
                  type="button"
                  onClick={onSaveFavourite}
                  className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                  <BookmarkPlus className="h-4 w-4" />
                  {tl('saveToFavourites')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {active && activeVerdict !== 'refused' && (
        <div
          data-testid="browser-rescue-notice"
          className="flex shrink-0 items-center gap-1 border-t border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
        >
          <span className="min-w-0 leading-snug">
            {activeVerdict === 'unknown' ? t('unknownNotice') : t('rescueNotice')}
          </span>
          <button
            type="button"
            onClick={() => void openExternalUrl(active.url)}
            className="shrink-0 rounded px-1 font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10"
          >
            {tl('openExternally')}
          </button>
        </div>
      )}
    </div>
  );
}
