'use client';
/**
 * HistoryNavButtons
 *
 * The header's back / forward pair. Each button is disabled when the in-app
 * history (useNavigationHistoryStore) has nothing on that side. Replaces the
 * per-page "back" buttons, so going back works the same way on every screen.
 */
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  selectCanGoBack,
  selectCanGoForward,
  useNavigationHistoryStore,
} from './navigation-history-store';

const BUTTON_CLASS =
  'p-1 sm:p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:text-zinc-300 dark:disabled:text-zinc-700 disabled:hover:bg-transparent dark:disabled:hover:bg-transparent disabled:cursor-default';

/** Back / forward buttons for the header's left block. */
export function HistoryNavButtons() {
  const router = useRouter();
  const t = useTranslations('nav');
  const canGoBack = useNavigationHistoryStore(selectCanGoBack);
  const canGoForward = useNavigationHistoryStore(selectCanGoForward);

  return (
    <div className="flex items-center" data-testid="history-nav">
      <button
        type="button"
        onClick={() => router.back()}
        disabled={!canGoBack}
        className={BUTTON_CLASS}
        aria-label={t('goBack')}
        title={t('goBack')}
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
      <button
        type="button"
        onClick={() => router.forward()}
        disabled={!canGoForward}
        className={BUTTON_CLASS}
        aria-label={t('goForward')}
        title={t('goForward')}
      >
        <ArrowRight className="w-5 h-5" />
      </button>
    </div>
  );
}
