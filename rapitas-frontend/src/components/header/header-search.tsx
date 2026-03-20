'use client';
/**
 * header/header-search.tsx
 *
 * Search input bar rendered in the center of the main header bar.
 * Clears the query and resets the route when the ✕ button is clicked.
 */

import { usePathname, useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

type HeaderSearchProps = {
  /** Current value of the search input. / 検索入力の現在値 */
  searchQuery: string;
  /** Updates the search query state. / 検索クエリのステートを更新する */
  setSearchQuery: (v: string) => void;
  /** Handles Enter key to navigate to /search. / Enterキーで/searchへナビゲート */
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Ref to the debounce timer so it can be cancelled on clear. / クリア時にキャンセルするデバウンスタイマーのRef */
  debounceTimerRef: React.RefObject<NodeJS.Timeout | null>;
};

/**
 * Controlled search input with a clear button that resets the URL search param.
 */
export function HeaderSearch({
  searchQuery,
  setSearchQuery,
  handleSearchKeyDown,
  debounceTimerRef,
}: HeaderSearchProps) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('nav');

  const handleClear = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    setSearchQuery('');
    if (pathname === '/search') {
      router.push('/search');
    } else if (pathname === '/kanban') {
      router.push('/kanban');
    } else if (pathname === '/') {
      router.push('/');
    }
  };

  return (
    <div className="flex-1 max-w-md mx-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={t('searchPlaceholder')}
          className="w-full pl-10 pr-4 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-zinc-400 dark:placeholder-zinc-500 transition-all"
        />
        {searchQuery && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
