'use client';
/**
 * BrowsingDataRow
 *
 * "Clear browsing data" for the in-app browser, shown under the "how links
 * open" setting (Q11). Desktop: a button that clears the in-app browser's own
 * cookies and storage. Web: the site data lives in the user's browser, so
 * only a pointer to the browser's settings is shown.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Cookie } from 'lucide-react';
import { isTauri } from '@/utils/tauri';
import { useClearBrowsingData } from '@/components/link-view/browser-screen/useClearBrowsingData';

/** The clear-browsing-data row. */
export function BrowsingDataRow() {
  const t = useTranslations('browser');
  const clear = useClearBrowsingData();
  // After mount: the desktop/web split must match the server render first.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => setIsDesktop(isTauri()), []);

  return (
    <div
      data-testid="browsing-data-row"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800"
    >
      <p className="min-w-0 flex-1 text-xs text-zinc-500 dark:text-zinc-400">
        {isDesktop ? t('clearDataSettingsHint') : t('webClearDataHint')}
      </p>
      {isDesktop && (
        <button
          type="button"
          onClick={() => void clear()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-zinc-700 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          <Cookie className="h-4 w-4" />
          {t('clearData')}
        </button>
      )}
    </div>
  );
}
