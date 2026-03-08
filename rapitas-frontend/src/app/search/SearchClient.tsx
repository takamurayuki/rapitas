'use client';

import { useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, SearchX } from 'lucide-react';
import { useGlobalSearch, type SearchResultType } from '@/hooks/useGlobalSearch';
import SearchResultCard from '@/feature/search/components/SearchResultCard';
import Pagination from '@/components/ui/pagination/Pagination';

export default function SearchClient() {
  const t = useTranslations('search');

  const TYPE_TABS: { key: SearchResultType | 'all'; label: string }[] = [
    { key: 'all', label: t('filterAll') },
    { key: 'task', label: t('filterTask') },
    { key: 'comment', label: t('filterComment') },
    { key: 'resource', label: t('filterResource') },
  ];

  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuery = searchParams.get('q') || '';
  const initialType = searchParams.get('type') as SearchResultType | null;
  const initialPage = parseInt(searchParams.get('page') || '1', 10);

  const initialLimit = parseInt(searchParams.get('limit') || '10', 10);

  // 初期値として使用するためのtypes（URLパラメータベース）
  const initialTypes = useMemo(() =>
    initialType === null || initialType === 'all' ? undefined : [initialType as SearchResultType],
    [initialType]
  );

  // useGlobalSearchのオプションをメモ化
  const searchOptions = useMemo(() => ({
    initialQuery,
    types: initialTypes,
    limit: initialLimit,
    debounceDelay: 400,
  }), [initialQuery, initialTypes, initialLimit]);

  const {
    query,
    setQuery,
    results,
    total,
    loading,
    error,
    offset,
    setOffset,
    limit,
    setLimit,
    types: currentTypes,
    setTypes,
  } = useGlobalSearch(searchOptions);

  // アクティブタイプをフックの現在の状態から決定
  const activeType = currentTypes ? currentTypes[0] || 'all' : (initialType || 'all');

  // Sync offset with page param
  useEffect(() => {
    setOffset((initialPage - 1) * limit);
  }, [initialPage, limit, setOffset]);

  // Sync query from URL on mount
  useEffect(() => {
    if (initialQuery && query !== initialQuery) {
      setQuery(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  const updateUrl = useCallback(
    (newQuery: string, newType: string, newPage: number, newLimit?: number) => {
      const params = new URLSearchParams();
      if (newQuery) params.set('q', newQuery);
      if (newType !== 'all') params.set('type', newType);
      if (newPage > 1) params.set('page', String(newPage));
      const currentLimit = newLimit || limit;
      if (currentLimit !== 10) params.set('limit', String(currentLimit));
      router.push(`/search?${params.toString()}`);
    },
    [router], // limit を依存配列から除去 - 実行時に最新値を参照
  );

  const handleTypeChange = (type: SearchResultType | 'all') => {
    const newTypes = type === 'all' ? undefined : [type];
    setTypes(newTypes); // useGlobalSearchに直接通知
    updateUrl(query, type, 1);
  };

  const handlePageChange = (page: number) => {
    setOffset((page - 1) * limit);
    updateUrl(query, activeType, page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleItemsPerPageChange = (newLimit: number) => {
    setLimit(newLimit);
    updateUrl(query, activeType, 1, newLimit);
  };


  return (
    <div className="max-w-3xl mx-auto p-6">

      {/* Type filter tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTypeChange(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeType === tab.key
                ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Results info */}
      {query && !loading && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4 animate-in fade-in-0 duration-200">
          {t('searchResultsFor', { query, total })}
        </p>
      )}

      {/* Results container with stable height */}
      <div className="min-h-[500px] relative">
        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4 animate-in fade-in-0 duration-200">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 animate-pulse min-h-[96px]"
              >
                <div className="flex items-start gap-3">
                  {/* Icon skeleton - matches SearchResultCard icon */}
                  <div className="flex-shrink-0 w-8 h-8 bg-zinc-200 dark:bg-zinc-700 rounded-lg" />

                  {/* Content skeleton */}
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Title row - matches h3 + ExternalLink */}
                    <div className="flex items-center gap-2">
                      <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-2/3" />
                      <div className="w-3.5 h-3.5 bg-zinc-200 dark:bg-zinc-700 rounded" />
                    </div>

                    {/* Excerpt skeleton - matches line-clamp-2 */}
                    <div className="space-y-1">
                      <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded w-full" />
                      <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded w-4/5" />
                    </div>

                    {/* Metadata badges row - matches badge layout */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <div className="h-5 w-12 bg-zinc-200 dark:bg-zinc-700 rounded" />
                      <div className="h-5 w-10 bg-zinc-200 dark:bg-zinc-700 rounded" />
                      <div className="h-5 w-8 bg-zinc-200 dark:bg-zinc-700 rounded" />
                      <div className="ml-auto h-3 w-16 bg-zinc-200 dark:bg-zinc-700 rounded" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Results list */}
        {!loading && results.length > 0 && (
          <div className="space-y-3 animate-in fade-in-0 duration-300">
            {results.map((result, index) => (
              <div
                key={`${result.type}-${result.id}`}
                className="animate-in fade-in-0 slide-in-from-top-2 duration-300"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <SearchResultCard
                  result={result}
                  query={query}
                />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && query && results.length === 0 && !error && (
          <div className="text-center py-16 animate-in fade-in-0 duration-300">
            <SearchX className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
            <p className="text-zinc-500 dark:text-zinc-400 mb-2">
              {t('noMatchResults', { query })}
            </p>
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              {t('tryDifferentKeyword')}
            </p>
          </div>
        )}

        {/* Initial state (no query) */}
        {!loading && !query && (
          <div className="text-center py-16 animate-in fade-in-0 duration-300">
            <Search className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
            <p className="text-zinc-500 dark:text-zinc-400">
              {t('enterKeywordToSearch')}
            </p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          itemsPerPage={limit}
          onPageChange={handlePageChange}
          onItemsPerPageChange={handleItemsPerPageChange}
          itemsPerPageOptions={[5, 10, 15]}
        />
      )}
    </div>
  );
}
