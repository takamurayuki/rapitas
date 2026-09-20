'use client';

/**
 * ConcernSearchPanel
 *
 * PERF concern search: text field + voice button + keyboard-navigable results +
 * polite live-region count. Text search always works; voice is disabled offline
 * (Whisper is backend-served) or when unsupported. Owns no fetching logic.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Mic, MicOff, Search } from 'lucide-react';
import Pagination from '@/components/ui/pagination/Pagination';
import { useSpeechRecognition } from '@/hooks/common/useSpeechRecognition';
import { useConcernSearch } from '../../_hooks/use-concern-search';
import { ConcernSearchList } from './concern-search-list';

export default function ConcernSearchPanel() {
  const t = useTranslations('concerns');
  const { items, isOnline, hasError, searchCount, search } = useConcernSearch();
  const [query, setQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const runSearch = (text: string) => {
    setCurrentPage(1);
    void search(text);
  };

  const speech = useSpeechRecognition('en-US', (transcript) => {
    setQuery(transcript);
    runSearch(transcript);
  });

  // NOTE: Reset paging when the result set changes so we never land past the last page.
  useEffect(() => {
    setCurrentPage(1);
  }, [items]);

  const voiceDisabledReason = !isOnline
    ? t('search.voiceOffline')
    : !speech.isSupported
      ? t('search.voiceUnsupported')
      : null;
  const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
  const pageItems = items.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <section
      aria-label={t('search.title')}
      className="mb-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/50"
    >
      <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
        {t('search.title')}
      </h2>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query);
        }}
        className="mb-3 flex items-center gap-2"
      >
        <input
          type="search"
          aria-label={t('search.inputLabel')}
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <button
          type="button"
          disabled={voiceDisabledReason !== null}
          aria-describedby={voiceDisabledReason ? 'concern-search-voice-hint' : undefined}
          aria-label={speech.isListening ? t('search.voiceStop') : t('search.voiceStart')}
          onClick={() => (speech.isListening ? speech.stopListening() : speech.startListening())}
          className="rounded-lg border border-zinc-300 p-2 text-zinc-700 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200"
        >
          {voiceDisabledReason ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <button
          type="submit"
          className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 dark:bg-indigo-500"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          {t('search.submit')}
        </button>
      </form>

      {voiceDisabledReason && (
        <p id="concern-search-voice-hint" className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
          {voiceDisabledReason}
        </p>
      )}
      {hasError && (
        <p role="alert" className="mb-2 text-xs text-rose-600 dark:text-rose-300">
          {t('search.error')}
        </p>
      )}
      {/* Live region stays mounted so screen readers announce each new count. */}
      <p role="status" aria-live="polite" className="sr-only">
        {searchCount > 0 ? t('search.resultCount', { count: items.length }) : ''}
      </p>

      <ConcernSearchList items={pageItems} />

      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          itemsPerPage={itemsPerPage}
          onPageChange={setCurrentPage}
          onItemsPerPageChange={(n) => {
            setItemsPerPage(n);
            setCurrentPage(1);
          }}
        />
      )}
    </section>
  );
}
